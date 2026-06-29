// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {MarketRegistry} from "../core/MarketRegistry.sol";
import {EchoBounty} from "../core/EchoBounty.sol";
import {EchoHook} from "../core/EchoHook.sol";
import {ParticipationReceipt} from "../core/ParticipationReceipt.sol";
import {ValidationGate} from "../core/ValidationGate.sol";
import {AttributionRegistry} from "../core/AttributionRegistry.sol";
import {AttributionPayout} from "../core/AttributionPayout.sol";
import {DisputeResolver} from "../core/DisputeResolver.sol";
import {MockUSDC, MockIdentityRegistry, MockReputationRegistry, MockAgenticCommerce} from "./mocks/Mocks.sol";

/**
 * @title DisputeResolverTest
 * @notice P5 (adjudication ladder — staked-jury rung). Drives the full MarketRegistry stack plus
 *         the DisputeResolver sibling end-to-end: a rejected bounty finding is disputed, the
 *         requester counters, the owner-appointed jury votes, and the verdict flips the finding
 *         (paid floor) or sustains the rejection — with bond settlement and pull-based juror
 *         rewards. Also covers the parked Mode-A stake subject (disabled) and the no-reclaim
 *         interaction (a disputed finding blocks closeBounty).
 */
contract DisputeResolverTest is Test {
    MarketRegistry public registry;
    EchoHook public echoHook;
    ParticipationReceipt public receipts;
    ValidationGate public gate;
    AttributionRegistry public attribution;
    AttributionPayout public payout;
    DisputeResolver public resolver;

    MockUSDC public usdc;
    MockIdentityRegistry public identity;
    MockReputationRegistry public reputation;
    MockAgenticCommerce public agentic;

    address public requester = makeAddr("requester");
    address public submitter = makeAddr("submitter");
    address public treasury = makeAddr("treasury");
    address public juror1 = makeAddr("juror1");
    address public juror2 = makeAddr("juror2");
    address public juror3 = makeAddr("juror3");
    address public oracle = makeAddr("oracle");

    uint256 constant REQ_AGENT = 100;
    uint256 constant SUB_AGENT = 200;
    uint16 constant FEE_BPS = 500; // 5%
    uint256 constant POOL = 1000e6;
    uint256 constant DEFAULT_AWARD = 50e6;
    uint256 constant REVIEW_WINDOW = 5 days;

    uint256 constant MIN_BOND = 10e6;
    uint64 constant VOTING_PERIOD = 3 days;

    function setUp() public {
        usdc = new MockUSDC();
        identity = new MockIdentityRegistry();
        reputation = new MockReputationRegistry();
        agentic = new MockAgenticCommerce();

        registry = MarketRegistry(address(new ERC1967Proxy(address(new MarketRegistry()), new bytes(0))));
        echoHook = EchoHook(address(new ERC1967Proxy(address(new EchoHook()), new bytes(0))));
        receipts = ParticipationReceipt(address(new ERC1967Proxy(address(new ParticipationReceipt()), new bytes(0))));
        gate = ValidationGate(address(new ERC1967Proxy(address(new ValidationGate()), new bytes(0))));
        attribution = AttributionRegistry(address(new ERC1967Proxy(address(new AttributionRegistry()), new bytes(0))));
        payout = AttributionPayout(address(new ERC1967Proxy(address(new AttributionPayout()), new bytes(0))));
        resolver = DisputeResolver(address(new ERC1967Proxy(address(new DisputeResolver()), new bytes(0))));

        echoHook.initialize(address(agentic), address(reputation), address(usdc));
        receipts.initialize();
        registry.initialize(address(usdc), address(agentic), address(identity), address(echoHook), address(receipts));
        gate.initialize(address(identity));
        attribution.initialize();
        payout.initialize(address(attribution), 4000);
        resolver.initialize(address(usdc), MIN_BOND, VOTING_PERIOD);

        echoHook.setMarketRegistry(address(registry));
        receipts.setMarketRegistry(address(registry));
        registry.setValidationGate(address(gate));
        attribution.setPayout(address(payout));
        attribution.setMarketRegistry(address(registry));
        payout.setEchoHook(address(echoHook));
        registry.setAttributionRegistry(address(attribution));
        echoHook.setProtocolConfig(FEE_BPS, treasury, address(payout), address(attribution));

        // Wire the adjudication ladder both ways.
        registry.setDisputeResolver(address(resolver));
        resolver.setMarket(address(registry));
        resolver.setJuror(juror1, true);
        resolver.setJuror(juror2, true);
        resolver.setJuror(juror3, true);
        resolver.setAgentOracle(oracle);

        identity.setAgent(requester, REQ_AGENT);
        identity.setAgent(submitter, SUB_AGENT);

        usdc.mint(requester, 100_000e6);
        usdc.mint(submitter, 100_000e6);
    }

    // ---- helpers ----

    function _createBounty() internal returns (uint256 marketId) {
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        marketId = registry.createBounty(REQ_AGENT, "ipfs://b", keccak256("scope"), 0, DEFAULT_AWARD, REVIEW_WINDOW, POOL);
        vm.stopPrank();
    }

    /// @dev Submit a finding then have the requester reject it — the disputable starting state.
    function _submitAndReject(uint256 marketId) internal returns (uint256 findingIndex) {
        vm.prank(submitter);
        findingIndex = registry.submitFinding(marketId, SUB_AGENT, keccak256("finding"));
        vm.prank(requester);
        registry.rejectFinding(marketId, findingIndex);
    }

    function _openCounter(uint256 marketId, uint256 findingIndex) internal returns (uint256 disputeId) {
        vm.startPrank(submitter);
        usdc.approve(address(resolver), type(uint256).max);
        disputeId = resolver.openFindingDispute(marketId, findingIndex, MIN_BOND);
        vm.stopPrank();

        vm.startPrank(requester);
        usdc.approve(address(resolver), type(uint256).max);
        resolver.counter(disputeId);
        vm.stopPrank();
    }

    // ---- wiring ----

    function test_Wiring_ResolverAndJurors() public view {
        assertEq(registry.disputeResolver(), address(resolver));
        assertEq(resolver.jurorCount(), 3);
        assertEq(address(resolver.market()), address(registry));
    }

    function test_RevertWhen_SetMarketTwice() public {
        vm.expectRevert(DisputeResolver.AlreadySet.selector);
        resolver.setMarket(address(registry));
    }

    function test_RevertWhen_SetDisputeResolverTwice() public {
        vm.expectRevert(MarketRegistry.AlreadySet.selector);
        registry.setDisputeResolver(address(resolver));
    }

    // ---- open: flips finding to Disputed, blocks close ----

    function test_OpenDispute_FlipsFindingToDisputed_BlocksClose() public {
        uint256 marketId = _createBounty();
        uint256 fi = _submitAndReject(marketId);
        assertEq(registry.bountyPendingCount(marketId), 0, "rejected clears pending");

        vm.startPrank(submitter);
        usdc.approve(address(resolver), type(uint256).max);
        resolver.openFindingDispute(marketId, fi, MIN_BOND);
        vm.stopPrank();

        EchoBounty.Finding[] memory fs = registry.getBountyFindings(marketId);
        assertEq(uint8(fs[fi].status), uint8(EchoBounty.FindingStatus.Disputed), "finding now disputed");
        assertEq(registry.bountyPendingCount(marketId), 1, "dispute re-counts as pending");

        vm.prank(requester);
        vm.expectRevert(MarketRegistry.FindingsStillPending.selector);
        registry.closeBounty(marketId);
    }

    function test_RevertWhen_DisputeNonRejectedFinding() public {
        uint256 marketId = _createBounty();
        vm.prank(submitter);
        uint256 fi = registry.submitFinding(marketId, SUB_AGENT, keccak256("f")); // still Pending

        vm.startPrank(submitter);
        usdc.approve(address(resolver), type(uint256).max);
        vm.expectRevert(MarketRegistry.FindingNotRejected.selector);
        resolver.openFindingDispute(marketId, fi, MIN_BOND);
        vm.stopPrank();
    }

    function test_RevertWhen_BondTooSmall() public {
        uint256 marketId = _createBounty();
        uint256 fi = _submitAndReject(marketId);
        vm.startPrank(submitter);
        usdc.approve(address(resolver), type(uint256).max);
        vm.expectRevert(DisputeResolver.BondTooSmall.selector);
        resolver.openFindingDispute(marketId, fi, MIN_BOND - 1);
        vm.stopPrank();
    }

    // ---- only the resolver may drive market callbacks ----

    function test_RevertWhen_DirectCallbackNotResolver() public {
        uint256 marketId = _createBounty();
        uint256 fi = _submitAndReject(marketId);
        vm.expectRevert(MarketRegistry.NotDisputeResolver.selector);
        registry.markFindingDisputed(marketId, fi);
        vm.expectRevert(MarketRegistry.NotDisputeResolver.selector);
        registry.resolveDisputedFinding(marketId, fi, true);
    }

    // ---- vote + resolve: opener (submitter) wins → finding paid the floor ----

    function test_Resolve_OpenerWins_PaysFloor_AndSettlesBonds() public {
        uint256 marketId = _createBounty();
        uint256 fi = _submitAndReject(marketId);
        uint256 disputeId = _openCounter(marketId, fi);

        // 2 of 3 jurors side with the opener (finding valid).
        vm.prank(juror1);
        resolver.vote(disputeId, true);
        vm.prank(juror2);
        resolver.vote(disputeId, true);
        vm.prank(juror3);
        resolver.vote(disputeId, false);

        vm.warp(block.timestamp + VOTING_PERIOD);

        uint256 subBefore = usdc.balanceOf(submitter);
        resolver.resolve(disputeId);

        // Finding ruled valid → Accepted, paid DEFAULT_AWARD net of 5% fee = 47.5; plus the opener
        // (submitter) refunded their own MIN_BOND.
        EchoBounty.Finding[] memory fs = registry.getBountyFindings(marketId);
        assertEq(uint8(fs[fi].status), uint8(EchoBounty.FindingStatus.Accepted), "finding accepted");
        assertEq(usdc.balanceOf(submitter) - subBefore, 47.5e6 + MIN_BOND, "floor net of fee + own bond back");
        assertEq(registry.bountyPendingCount(marketId), 0, "dispute cleared");

        // Winning-side jurors split the loser's (requester's) bond: MIN_BOND / 2 each.
        uint256 share = MIN_BOND / 2;
        vm.prank(juror1);
        resolver.claimJurorReward(disputeId);
        assertEq(usdc.balanceOf(juror1), share, "juror1 share");
        vm.prank(juror2);
        resolver.claimJurorReward(disputeId);
        assertEq(usdc.balanceOf(juror2), share, "juror2 share");

        // The losing-side juror cannot claim.
        vm.prank(juror3);
        vm.expectRevert(DisputeResolver.NotWinningVoter.selector);
        resolver.claimJurorReward(disputeId);
    }

    // ---- vote + resolve: counter (requester) wins → rejection sustained ----

    function test_Resolve_CounterWins_SustainsRejection() public {
        uint256 marketId = _createBounty();
        uint256 fi = _submitAndReject(marketId);
        uint256 disputeId = _openCounter(marketId, fi);

        vm.prank(juror1);
        resolver.vote(disputeId, false);
        vm.prank(juror2);
        resolver.vote(disputeId, false);

        vm.warp(block.timestamp + VOTING_PERIOD);

        uint256 reqBefore = usdc.balanceOf(requester);
        uint256 subBefore = usdc.balanceOf(submitter);
        resolver.resolve(disputeId);

        EchoBounty.Finding[] memory fs = registry.getBountyFindings(marketId);
        assertEq(uint8(fs[fi].status), uint8(EchoBounty.FindingStatus.Rejected), "rejection sustained");
        assertEq(usdc.balanceOf(submitter), subBefore, "loser opener gets nothing back");
        // Requester refunded own bond; submitter's bond becomes the juror pot.
        assertEq(usdc.balanceOf(requester) - reqBefore, MIN_BOND, "winner counter bond refunded");
        assertEq(registry.bountyPendingCount(marketId), 0, "dispute cleared, close now possible");
    }

    function test_Resolve_TieFavorsOpener() public {
        uint256 marketId = _createBounty();
        uint256 fi = _submitAndReject(marketId);
        uint256 disputeId = _openCounter(marketId, fi);

        vm.prank(juror1);
        resolver.vote(disputeId, true);
        vm.prank(juror2);
        resolver.vote(disputeId, false);

        vm.warp(block.timestamp + VOTING_PERIOD);
        resolver.resolve(disputeId);

        EchoBounty.Finding[] memory fs = registry.getBountyFindings(marketId);
        assertEq(uint8(fs[fi].status), uint8(EchoBounty.FindingStatus.Accepted), "1-1 tie sustains the contested item (opener)");
    }

    // ---- guards on the vote/resolve flow ----

    function test_RevertWhen_VoteBeforeCounter() public {
        uint256 marketId = _createBounty();
        uint256 fi = _submitAndReject(marketId);
        vm.startPrank(submitter);
        usdc.approve(address(resolver), type(uint256).max);
        uint256 disputeId = resolver.openFindingDispute(marketId, fi, MIN_BOND);
        vm.stopPrank();

        vm.prank(juror1);
        vm.expectRevert(DisputeResolver.NotCountered.selector);
        resolver.vote(disputeId, true);
    }

    function test_RevertWhen_NonJurorVotes() public {
        uint256 marketId = _createBounty();
        uint256 fi = _submitAndReject(marketId);
        uint256 disputeId = _openCounter(marketId, fi);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(DisputeResolver.NotJuror.selector);
        resolver.vote(disputeId, true);
    }

    function test_RevertWhen_DoubleVote() public {
        uint256 marketId = _createBounty();
        uint256 fi = _submitAndReject(marketId);
        uint256 disputeId = _openCounter(marketId, fi);
        vm.startPrank(juror1);
        resolver.vote(disputeId, true);
        vm.expectRevert(DisputeResolver.AlreadyVoted.selector);
        resolver.vote(disputeId, false);
        vm.stopPrank();
    }

    function test_RevertWhen_VoteAfterWindow() public {
        uint256 marketId = _createBounty();
        uint256 fi = _submitAndReject(marketId);
        uint256 disputeId = _openCounter(marketId, fi);
        vm.warp(block.timestamp + VOTING_PERIOD);
        vm.prank(juror1);
        vm.expectRevert(DisputeResolver.VotingClosed.selector);
        resolver.vote(disputeId, true);
    }

    function test_RevertWhen_ResolveBeforeWindow() public {
        uint256 marketId = _createBounty();
        uint256 fi = _submitAndReject(marketId);
        uint256 disputeId = _openCounter(marketId, fi);
        vm.prank(juror1);
        resolver.vote(disputeId, true);
        vm.expectRevert(DisputeResolver.VotingNotOver.selector);
        resolver.resolve(disputeId);
    }

    function test_RevertWhen_ResolveNoVotes() public {
        uint256 marketId = _createBounty();
        uint256 fi = _submitAndReject(marketId);
        uint256 disputeId = _openCounter(marketId, fi);
        vm.warp(block.timestamp + VOTING_PERIOD);
        vm.expectRevert(DisputeResolver.NoVotes.selector);
        resolver.resolve(disputeId);
    }

    function test_RevertWhen_ResolveTwice() public {
        uint256 marketId = _createBounty();
        uint256 fi = _submitAndReject(marketId);
        uint256 disputeId = _openCounter(marketId, fi);
        vm.prank(juror1);
        resolver.vote(disputeId, true);
        vm.warp(block.timestamp + VOTING_PERIOD);
        resolver.resolve(disputeId);
        vm.expectRevert(DisputeResolver.NotResolved.selector);
        resolver.resolve(disputeId);
    }

    // ---- rung-1 advisory hint (non-binding) ----

    function test_AgentHint_RecordedButNonBinding() public {
        uint256 marketId = _createBounty();
        uint256 fi = _submitAndReject(marketId);
        vm.startPrank(submitter);
        usdc.approve(address(resolver), type(uint256).max);
        uint256 disputeId = resolver.openFindingDispute(marketId, fi, MIN_BOND);
        vm.stopPrank();

        vm.prank(oracle);
        resolver.recordAgentHint(disputeId, keccak256("looks-valid"));
        DisputeResolver.Dispute memory d = resolver.getDispute(disputeId);
        assertEq(d.agentHint, keccak256("looks-valid"), "hint recorded");

        vm.prank(makeAddr("notoracle"));
        vm.expectRevert(DisputeResolver.NotAgentOracle.selector);
        resolver.recordAgentHint(disputeId, keccak256("x"));
    }

    // ---- parked Mode-A stake subject (disabled until enabled) ----

    function test_RevertWhen_StakeDisputeDisabled() public {
        uint256 marketId = _createBounty();
        vm.startPrank(submitter);
        usdc.approve(address(resolver), type(uint256).max);
        vm.expectRevert(DisputeResolver.SubjectNotEnabled.selector);
        resolver.openStakeDispute(marketId, submitter, MIN_BOND);
        vm.stopPrank();
    }

    function test_EnableStakeSubject_OwnerOnly() public {
        resolver.setModeAStakeEnabled(true);
        assertTrue(resolver.modeAStakeEnabled());
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        resolver.setModeAStakeEnabled(false);
    }

    // ──────────────────── Mode-A stake dispute, end-to-end (P6) ────────────────────
    //
    // The requester (slash-seeker) opens a bonded ModeAStake dispute against a revealed applicant's
    // held stake — opening flags the reveal on the market. The applicant counters to defend; jurors
    // vote; resolve slashes the stake to the requester (sustained) or refunds the applicant (cleared).
    // `submitter` doubles as the Mode-A applicant here (it already has an identity + funds).

    uint256 constant STAKE_A = 10e6;
    uint64 constant FLAG_WINDOW_A = 2 days;

    /// @dev Create an OpenMarket reveal market with a held stake, have `submitter` apply, and have the
    ///      requester reveal — leaving submitter's stake Held behind the flag window.
    function _revealedHeldStake() internal returns (uint256 marketId) {
        uint256[4] memory tiers = [uint256(5e6), 50e6, 250e6, 1000e6];
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        marketId = registry.createMarketWithMode(
            "ipfs://m", keccak256("scope"), tiers, 0, 50, 7 days, 2000e6, REQ_AGENT,
            MarketRegistry.ModeConfig({mode: MarketRegistry.Mode.OpenMarket, requiredProofs: 0, stakeRequired: STAKE_A, flagWindow: FLAG_WINDOW_A})
        );
        vm.stopPrank();

        vm.startPrank(submitter);
        usdc.approve(address(registry), type(uint256).max);
        registry.applyToMarket(marketId, SUB_AGENT, keccak256("sub"));
        vm.stopPrank();

        vm.prank(requester);
        registry.reveal(marketId, submitter); // stake now Held
    }

    /// @dev Enable the subject, requester opens (flags), applicant counters → voting window open.
    function _openStakeCounter(uint256 marketId) internal returns (uint256 disputeId) {
        resolver.setModeAStakeEnabled(true); // owner == this test
        vm.startPrank(requester); // the slash-seeker opens
        usdc.approve(address(resolver), type(uint256).max);
        disputeId = resolver.openStakeDispute(marketId, submitter, MIN_BOND);
        vm.stopPrank();

        vm.startPrank(submitter); // the applicant defends
        usdc.approve(address(resolver), type(uint256).max);
        resolver.counter(disputeId);
        vm.stopPrank();
    }

    function _countFeedback(Vm.Log[] memory logs, uint256 agentId) internal pure returns (uint256 n) {
        bytes32 sig = keccak256("Feedback(uint256,int128,string,string,bytes32)");
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length >= 2 && logs[i].topics[0] == sig && uint256(logs[i].topics[1]) == agentId) n++;
        }
    }

    function test_StakeDispute_OpenFlagsHold_BlocksAutoSettleAndClose() public {
        uint256 marketId = _revealedHeldStake();
        _openStakeCounter(marketId); // flags the hold

        // A flagged hold can't be auto-returned…
        vm.warp(block.timestamp + FLAG_WINDOW_A);
        vm.expectRevert(MarketRegistry.RevealNotHeld.selector);
        registry.settleRevealStake(marketId, submitter);

        // …nor closed over (floor=min(5,1)=1 is met by the single reveal, so only the flag blocks it).
        vm.prank(requester);
        vm.expectRevert(MarketRegistry.RevealStillFlagged.selector);
        registry.closeMarket(marketId);
    }

    function test_StakeDispute_SlashSustained_RoutesToRequester_WritesNegRep() public {
        uint256 marketId = _revealedHeldStake();
        uint256 disputeId = _openStakeCounter(marketId);

        // Strict majority for the opener (slash): 2 slash, 1 no-slash.
        vm.prank(juror1);
        resolver.vote(disputeId, true);
        vm.prank(juror2);
        resolver.vote(disputeId, true);
        vm.prank(juror3);
        resolver.vote(disputeId, false);

        vm.warp(block.timestamp + VOTING_PERIOD);

        uint256 reqBefore = usdc.balanceOf(requester);
        vm.recordLogs();
        resolver.resolve(disputeId);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // Requester gets their own bond back (MIN_BOND) + the slashed stake (STAKE_A).
        assertEq(usdc.balanceOf(requester) - reqBefore, MIN_BOND + STAKE_A, "bond refund + slashed stake");
        assertEq(echoHook.stakeBalance(marketId, submitter), 0, "stake slashed");
        // The sustained bait writes a -1 P-Rep against the applicant.
        assertGe(_countFeedback(logs, SUB_AGENT), 1, "applicant got bait_sustained feedback");
    }

    function test_StakeDispute_Cleared_RefundsApplicant() public {
        uint256 marketId = _revealedHeldStake();
        uint256 disputeId = _openStakeCounter(marketId);

        // Majority for the counter (no slash): 2 no-slash, 1 slash.
        vm.prank(juror1);
        resolver.vote(disputeId, false);
        vm.prank(juror2);
        resolver.vote(disputeId, false);
        vm.prank(juror3);
        resolver.vote(disputeId, true);

        vm.warp(block.timestamp + VOTING_PERIOD);

        uint256 subBefore = usdc.balanceOf(submitter);
        resolver.resolve(disputeId);

        // Applicant (counter/winner) gets their own bond back (MIN_BOND) + the refunded stake.
        assertEq(usdc.balanceOf(submitter) - subBefore, MIN_BOND + STAKE_A, "bond refund + stake returned");
        assertEq(echoHook.stakeBalance(marketId, submitter), 0, "stake cleared");
    }

    function test_StakeDispute_TieFavorsNoSlash() public {
        uint256 marketId = _revealedHeldStake();
        uint256 disputeId = _openStakeCounter(marketId);

        // 1-1 tie. For ModeAStake a slash needs a STRICT majority → tie favors the applicant.
        vm.prank(juror1);
        resolver.vote(disputeId, true); // slash
        vm.prank(juror2);
        resolver.vote(disputeId, false); // no slash

        vm.warp(block.timestamp + VOTING_PERIOD);

        uint256 subBefore = usdc.balanceOf(submitter);
        resolver.resolve(disputeId);
        assertEq(usdc.balanceOf(submitter) - subBefore, MIN_BOND + STAKE_A, "tie -> no slash -> applicant made whole");
        assertEq(echoHook.stakeBalance(marketId, submitter), 0, "stake refunded on tie");
    }

    function test_StakeDispute_RevertWhen_OpenAfterFlagWindow() public {
        uint256 marketId = _revealedHeldStake();
        resolver.setModeAStakeEnabled(true);
        vm.warp(block.timestamp + FLAG_WINDOW_A); // window closed before the flag

        vm.startPrank(requester);
        uint256 reqBefore = usdc.balanceOf(requester);
        usdc.approve(address(resolver), type(uint256).max);
        vm.expectRevert(MarketRegistry.FlagWindowElapsed.selector);
        resolver.openStakeDispute(marketId, submitter, MIN_BOND);
        vm.stopPrank();
        // The bond transfer is unwound by the revert.
        assertEq(usdc.balanceOf(requester), reqBefore, "bond unwound on a too-late flag");
    }

    // ──────────────────── TierJobRejection dispute, end-to-end (worker recourse) ────────────────────
    //
    // A worker contests an unfair Final-tier reject. The worker (the Arc job's provider) opens a bonded
    // TierJobRejection dispute — opening marks the job disputed on the market (blocking close). The
    // requester counters; jurors vote; resolve overturns the rejection (pay the worker the tier amount
    // net of fee) or sustains it (escrow refunds the requester on close). Locked decision: a TIE pays
    // the WORKER (benefit-of-the-doubt, forOpener >= against — same as BountyFinding, NOT ModeAStake).

    uint256[4] TIERS = [uint256(5e6), 50e6, 250e6, 1000e6];
    uint256 constant ESCROW = 2000e6;
    uint256 constant FINAL_AMT = 250e6;                 // TIERS[2]
    uint256 constant FINAL_NET = FINAL_AMT - (FINAL_AMT * FEE_BPS) / 10_000; // 250 - 5% = 237.5

    /// @dev Plain Open market → submitter applies → graded straight to Final → submits → requester
    ///      rejects. Returns the disputable (marketId, Final jobId).
    function _finalRejected() internal returns (uint256 marketId, uint256 jobId) {
        (marketId, jobId) = _gradeToFinal();
        agentic.submit(jobId, keccak256("final-deliverable"));
        vm.prank(requester);
        agentic.reject(jobId, keccak256("reject-reason"));
    }

    /// @dev Build the market and grade `submitter` Substantive→Shortlist→Final; return the Final jobId.
    function _gradeToFinal() internal returns (uint256 marketId, uint256 jobId) {
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        marketId = registry.createMarket("ipfs://m", keccak256("scope"), TIERS, 0, 50, 7 days, ESCROW, REQ_AGENT);
        vm.stopPrank();

        vm.startPrank(submitter);
        usdc.approve(address(registry), type(uint256).max);
        registry.applyToMarket(marketId, SUB_AGENT, keccak256("sub"));
        vm.stopPrank();

        vm.startPrank(requester);
        registry.gradeSubstantive(marketId, submitter);
        registry.gradeShortlist(marketId, submitter);
        registry.gradeFinal(marketId, submitter);
        vm.stopPrank();

        uint256[] memory ids = registry.getApplication(marketId, submitter).tierJobIds;
        jobId = ids[ids.length - 1];
    }

    /// @dev Worker opens the tier dispute, requester counters → voting window open.
    function _openTierCounter(uint256 marketId, uint256 jobId) internal returns (uint256 disputeId) {
        vm.startPrank(submitter); // the worker (Arc job provider)
        usdc.approve(address(resolver), type(uint256).max);
        disputeId = resolver.openTierJobDispute(marketId, jobId, MIN_BOND);
        vm.stopPrank();

        vm.startPrank(requester); // the rejecting requester defends
        usdc.approve(address(resolver), type(uint256).max);
        resolver.counter(disputeId);
        vm.stopPrank();
    }

    function test_TierDispute_OpenMarksDisputed_BlocksClose() public {
        (uint256 marketId, uint256 jobId) = _finalRejected();

        vm.startPrank(submitter);
        usdc.approve(address(resolver), type(uint256).max);
        resolver.openTierJobDispute(marketId, jobId, MIN_BOND);
        vm.stopPrank();

        assertTrue(echoHook.tierJobDisputed(jobId), "job flagged disputed");

        vm.prank(requester);
        vm.expectRevert(MarketRegistry.FinalJobDisputed.selector);
        registry.closeMarket(marketId);
    }

    function test_TierDispute_WorkerWins_PaidNetFee_AndReputation() public {
        (uint256 marketId, uint256 jobId) = _finalRejected();
        uint256 disputeId = _openTierCounter(marketId, jobId);

        // 2 of 3 jurors side with the worker (rejection was unfair).
        vm.prank(juror1);
        resolver.vote(disputeId, true);
        vm.prank(juror2);
        resolver.vote(disputeId, true);
        vm.prank(juror3);
        resolver.vote(disputeId, false);

        vm.warp(block.timestamp + VOTING_PERIOD);

        uint256 subBefore = usdc.balanceOf(submitter);
        vm.recordLogs();
        resolver.resolve(disputeId);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // Worker paid the Final tier net of fee + own bond refunded; escrow records the spend so close
        // can't double-refund it to the requester.
        assertEq(usdc.balanceOf(submitter) - subBefore, FINAL_NET + MIN_BOND, "tier net of fee + own bond back");
        assertEq(echoHook.distributed(marketId), FINAL_AMT, "tier amount marked distributed");
        assertFalse(echoHook.tierJobDisputed(jobId), "dispute cleared");
        // Worker earns the tier_final vouch (and requester the 'responded' credit).
        assertGe(_countFeedback(logs, SUB_AGENT), 1, "worker got tier_final feedback");
    }

    function test_TierDispute_TiePaysWorker() public {
        (uint256 marketId, uint256 jobId) = _finalRejected();
        uint256 disputeId = _openTierCounter(marketId, jobId);

        // 1-1 tie. LOCKED DECISION: a tie pays the WORKER (benefit-of-the-doubt, forOpener >= against).
        vm.prank(juror1);
        resolver.vote(disputeId, true);  // for worker
        vm.prank(juror2);
        resolver.vote(disputeId, false); // for requester

        vm.warp(block.timestamp + VOTING_PERIOD);

        uint256 subBefore = usdc.balanceOf(submitter);
        resolver.resolve(disputeId);

        assertEq(usdc.balanceOf(submitter) - subBefore, FINAL_NET + MIN_BOND, "tie -> worker paid net + own bond");
        assertEq(echoHook.distributed(marketId), FINAL_AMT, "tie spent the tier escrow on the worker");
    }

    function test_TierDispute_WorkerLoses_RequesterRefundedOnClose() public {
        (uint256 marketId, uint256 jobId) = _finalRejected();
        uint256 disputeId = _openTierCounter(marketId, jobId);

        // Majority for the requester → rejection sustained.
        vm.prank(juror1);
        resolver.vote(disputeId, false);
        vm.prank(juror2);
        resolver.vote(disputeId, false);

        vm.warp(block.timestamp + VOTING_PERIOD);
        resolver.resolve(disputeId);

        // No money moved out of escrow; the rejection stands.
        assertEq(echoHook.distributed(marketId), 0, "loss -> nothing distributed");
        assertFalse(echoHook.tierJobDisputed(jobId), "dispute cleared, close now possible");

        // Requester closes and reclaims the full escrow (including the contested tier amount).
        uint256 reqBefore = usdc.balanceOf(requester);
        vm.prank(requester);
        registry.closeMarket(marketId);
        assertEq(usdc.balanceOf(requester) - reqBefore, ESCROW, "full escrow refunded once");
        assertEq(echoHook.remainingEscrow(marketId), 0, "escrow emptied");
    }

    function test_TierDispute_GhostBlockedAfterWorkerWin() public {
        (uint256 marketId, uint256 jobId) = _finalRejected();
        uint256 disputeId = _openTierCounter(marketId, jobId);
        vm.prank(juror1);
        resolver.vote(disputeId, true);
        vm.warp(block.timestamp + VOTING_PERIOD);
        resolver.resolve(disputeId); // worker paid, ctx.disputeSettled = true

        // A late ghost trigger on the same job can't double-spend the escrow.
        vm.expectRevert(EchoHook.AlreadyWithdrawn.selector);
        registry.triggerGhost(marketId, submitter);
    }

    function test_TierDispute_RevertWhen_NotProvider_BondUnwound() public {
        (uint256 marketId, uint256 jobId) = _finalRejected();
        // `requester` is the job's client/evaluator, NOT the provider — may not open the worker's dispute.
        vm.startPrank(requester);
        uint256 reqBefore = usdc.balanceOf(requester);
        usdc.approve(address(resolver), type(uint256).max);
        vm.expectRevert(EchoHook.NotProvider.selector);
        resolver.openTierJobDispute(marketId, jobId, MIN_BOND);
        vm.stopPrank();
        assertEq(usdc.balanceOf(requester), reqBefore, "bond unwound for a non-provider opener");
    }

    function test_TierDispute_RevertWhen_JobNotRejected() public {
        (uint256 marketId, uint256 jobId) = _gradeToFinal();
        agentic.submit(jobId, keccak256("final-deliverable")); // Submitted, not Rejected

        vm.startPrank(submitter);
        usdc.approve(address(resolver), type(uint256).max);
        vm.expectRevert(EchoHook.JobNotRejected.selector);
        resolver.openTierJobDispute(marketId, jobId, MIN_BOND);
        vm.stopPrank();
    }

    function test_TierDispute_RevertWhen_WrongTier() public {
        // Reject a non-Final (Substantive) tier job → not eligible for tier-rejection recourse.
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        uint256 marketId = registry.createMarket("ipfs://m", keccak256("scope"), TIERS, 0, 50, 7 days, ESCROW, REQ_AGENT);
        vm.stopPrank();
        vm.startPrank(submitter);
        usdc.approve(address(registry), type(uint256).max);
        registry.applyToMarket(marketId, SUB_AGENT, keccak256("sub"));
        vm.stopPrank();
        vm.prank(requester);
        registry.gradeSubstantive(marketId, submitter);
        uint256[] memory ids = registry.getApplication(marketId, submitter).tierJobIds;
        uint256 jobId = ids[0];
        agentic.submit(jobId, keccak256("d"));
        vm.prank(requester);
        agentic.reject(jobId, keccak256("r"));

        vm.startPrank(submitter);
        usdc.approve(address(resolver), type(uint256).max);
        vm.expectRevert(EchoHook.WrongTier.selector);
        resolver.openTierJobDispute(marketId, jobId, MIN_BOND);
        vm.stopPrank();
    }

    function test_TierDispute_RevertWhen_DoubleDispute() public {
        (uint256 marketId, uint256 jobId) = _finalRejected();
        vm.startPrank(submitter);
        usdc.approve(address(resolver), type(uint256).max);
        resolver.openTierJobDispute(marketId, jobId, MIN_BOND);
        vm.expectRevert(EchoHook.TierJobAlreadyDisputed.selector);
        resolver.openTierJobDispute(marketId, jobId, MIN_BOND);
        vm.stopPrank();
    }

    function test_TierDispute_RevertWhen_DirectCallbacksNotResolver() public {
        (uint256 marketId, uint256 jobId) = _finalRejected();
        vm.expectRevert(MarketRegistry.NotDisputeResolver.selector);
        registry.markTierJobDisputed(marketId, jobId, submitter);
        vm.expectRevert(MarketRegistry.NotDisputeResolver.selector);
        registry.resolveTierJobDispute(marketId, jobId, true);
    }
}
