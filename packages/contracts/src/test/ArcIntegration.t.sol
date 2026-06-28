// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {MarketRegistry} from "../core/MarketRegistry.sol";
import {EchoHook} from "../core/EchoHook.sol";
import {ParticipationReceipt} from "../core/ParticipationReceipt.sol";
import {AttributionRegistry} from "../core/AttributionRegistry.sol";
import {AttributionPayout} from "../core/AttributionPayout.sol";
import {AgenticCommerce} from "../arc/AgenticCommerce.sol";
import {MockUSDC, MockIdentityRegistry, MockReputationRegistry} from "./mocks/Mocks.sol";

/**
 * @title ArcIntegrationTest
 * @notice Drives the full Echo lifecycle through the REAL (vendored) Arc AgenticCommerce —
 *         not the mock — exercising the actual IACPHook before/afterAction dispatch, the
 *         ERC-165 + whitelist gate on createJob, and the genuine Open→Submitted→Completed
 *         status machine. This is the test class that would have caught the original
 *         imagined-interface bug: settlement only fires if Echo speaks Arc's real hook ABI.
 *
 *         Identity + reputation are still mocked (their surfaces are simple and verified
 *         live); the point here is the AgenticCommerce boundary.
 */
contract ArcIntegrationTest is Test {
    // Mirror of EchoHook's events so vm.expectEmit can match by topic0 without going through the
    // cross-contract `Contract.Event(...)` syntax (which has hashing quirks across forge versions).
    event GhostPenalty(uint256 indexed marketId, uint256 indexed jobId, address indexed participant, uint256 amount, address requester);
    event WorkerGhosted(uint256 indexed marketId, uint256 indexed jobId, address indexed participant, uint256 participantAgentId);
    event RRepSlashed(uint256 indexed requesterAgentId, uint256 indexed marketId, uint256 amount);

    MarketRegistry public registry;
    EchoHook public echoHook;
    ParticipationReceipt public receipts;
    AttributionRegistry public attribution;
    AttributionPayout public payout;
    AgenticCommerce public agentic; // the REAL vendored contract, behind a proxy

    MockUSDC public usdc;
    MockIdentityRegistry public identity;
    MockReputationRegistry public reputation;

    address public requester = makeAddr("requester");
    address public participant = makeAddr("participant");
    address public sam = makeAddr("sam"); // introducer
    address public treasury = makeAddr("treasury");
    address public admin = address(this); // admin of the AC instance

    uint256 constant REQ_AGENT = 100;
    uint256 constant PART_AGENT = 200;

    uint256[4] public tierAmounts = [uint256(5e6), 50e6, 250e6, 1000e6];
    uint16 constant FEE_BPS = 500; // 5%
    uint256 constant MAX_APPLICANTS = 50;
    uint256 constant GHOST_DEADLINE = 7 days;
    uint256 constant ESCROW = 2000e6;

    function setUp() public {
        usdc = new MockUSDC();
        identity = new MockIdentityRegistry();
        reputation = new MockReputationRegistry();

        // REAL AgenticCommerce behind a UUPS proxy; this test contract is admin.
        AgenticCommerce acImpl = new AgenticCommerce();
        agentic = AgenticCommerce(address(new ERC1967Proxy(
            address(acImpl),
            abi.encodeWithSelector(AgenticCommerce.initialize.selector, address(usdc), treasury, admin)
        )));

        // Echo core proxies.
        registry = MarketRegistry(address(new ERC1967Proxy(address(new MarketRegistry()), new bytes(0))));
        echoHook = EchoHook(address(new ERC1967Proxy(address(new EchoHook()), new bytes(0))));
        receipts = ParticipationReceipt(address(new ERC1967Proxy(address(new ParticipationReceipt()), new bytes(0))));
        attribution = AttributionRegistry(address(new ERC1967Proxy(address(new AttributionRegistry()), new bytes(0))));
        payout = AttributionPayout(address(new ERC1967Proxy(address(new AttributionPayout()), new bytes(0))));

        echoHook.initialize(address(agentic), address(reputation), address(usdc));
        receipts.initialize();
        registry.initialize(address(usdc), address(agentic), address(identity), address(echoHook), address(receipts));
        attribution.initialize();
        payout.initialize(address(attribution), 4000);

        echoHook.setMarketRegistry(address(registry));
        receipts.setMarketRegistry(address(registry));
        attribution.setPayout(address(payout));
        attribution.setMarketRegistry(address(registry));
        payout.setEchoHook(address(echoHook));
        registry.setAttributionRegistry(address(attribution));
        echoHook.setProtocolConfig(FEE_BPS, treasury, address(payout), address(attribution));

        // The whole point of Path C: self-whitelist EchoHook on our own AC instance.
        agentic.setHookWhitelist(address(echoHook), true);

        identity.setAgent(requester, REQ_AGENT);
        identity.setAgent(participant, PART_AGENT);
        usdc.mint(requester, 100_000e6);
    }

    // ---- helpers ----

    function _createMarket() internal returns (uint256 marketId) {
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        marketId = registry.createMarket(
            "ipfs://market", keccak256("scope"), tierAmounts,
            0, MAX_APPLICANTS, GHOST_DEADLINE, ESCROW, REQ_AGENT
        );
        vm.stopPrank();
    }

    function _apply(uint256 marketId) internal {
        vm.prank(participant);
        registry.applyToMarket(marketId, PART_AGENT, keccak256("submission"));
    }

    /// @dev Grade up a tier, then drive the REAL job lifecycle: provider submits, evaluator
    ///      completes — which fires EchoHook.afterAction(complete) and settles the payout.
    function _gradeSubmitComplete(uint256 marketId, uint8 toTier) internal returns (uint256 jobId) {
        vm.startPrank(requester);
        if (toTier == 1) registry.gradeSubstantive(marketId, participant);
        else if (toTier == 2) registry.gradeShortlist(marketId, participant);
        else registry.gradeFinal(marketId, participant);
        vm.stopPrank();

        jobId = agentic.jobCounter(); // fresh instance → latest job is the one just created

        vm.prank(participant);
        agentic.submit(jobId, keccak256("deliverable"), hex"");
        vm.prank(requester);
        agentic.complete(jobId, keccak256("ok"), hex"");
    }

    // ---- tests ----

    function test_RealAC_Whitelisted() public view {
        assertTrue(agentic.whitelistedHooks(address(echoHook)), "EchoHook self-whitelisted");
    }

    function test_RealAC_CreateJob_FiresHook_AndStatusMachine() public {
        uint256 marketId = _createMarket();
        _apply(marketId);

        vm.prank(requester);
        registry.gradeSubstantive(marketId, participant);
        uint256 jobId = agentic.jobCounter();

        // Job exists on the real AC, Open, budget 0, hook = EchoHook.
        AgenticCommerce.Job memory job = agentic.getJob(jobId);
        assertEq(job.provider, participant, "provider = worker");
        assertEq(job.evaluator, requester, "evaluator = requester");
        assertEq(job.hook, address(echoHook), "hook wired");
        assertEq(uint8(job.status), uint8(AgenticCommerce.JobStatus.Open), "Open");
        assertEq(job.budget, 0, "budget 0: Echo settles from its own escrow");

        // submit → Submitted, complete → Completed (real transitions).
        vm.prank(participant);
        agentic.submit(jobId, keccak256("d"), hex"");
        assertEq(uint8(agentic.getJob(jobId).status), uint8(AgenticCommerce.JobStatus.Submitted));
        vm.prank(requester);
        agentic.complete(jobId, keccak256("ok"), hex"");
        assertEq(uint8(agentic.getJob(jobId).status), uint8(AgenticCommerce.JobStatus.Completed));
    }

    function test_RealAC_Settlement_PaysWorkerNetOfFee() public {
        uint256 marketId = _createMarket();
        _apply(marketId);
        _gradeSubmitComplete(marketId, 1);

        // Substantive gross $5; 5% fee = $0.25; worker nets $4.75; full fee → treasury margin.
        assertEq(usdc.balanceOf(participant), 4.75e6, "worker net of fee");
        assertEq(usdc.balanceOf(treasury), 0.25e6, "treasury gets fee margin");
    }

    function test_RealAC_AttributionPaysIntroducer() public {
        uint256 marketId = _createMarket();
        _apply(marketId);

        vm.prank(sam);
        uint256 arId = attribution.proposeAR(
            PART_AGENT, AttributionRegistry.AttributionType.Introduced,
            1000, AttributionRegistry.CurveType.Linear, uint32(3 * 365 days), 0
        );
        vm.prank(requester);
        registry.gradeSubstantive(marketId, participant);
        attribution.confirmAR(arId, requester);

        uint256 jobId = agentic.jobCounter();
        vm.prank(participant);
        agentic.submit(jobId, keccak256("d"), hex"");
        vm.prank(requester);
        agentic.complete(jobId, keccak256("ok"), hex"");

        // fee $0.25; Sam's 10% slice = $0.025; treasury keeps $0.225; worker whole.
        assertEq(usdc.balanceOf(sam), 0.025e6, "introducer paid from fee");
        assertEq(usdc.balanceOf(treasury), 0.225e6, "treasury keeps remainder");
        assertEq(usdc.balanceOf(participant), 4.75e6, "worker net");
    }

    function test_RealAC_TierProgression() public {
        uint256 marketId = _createMarket();
        _apply(marketId);
        _gradeSubmitComplete(marketId, 1);
        _gradeSubmitComplete(marketId, 2);
        _gradeSubmitComplete(marketId, 3);

        assertEq(usdc.balanceOf(participant), 4.75e6 + 47.5e6 + 237.5e6, "cumulative net");
        assertEq(registry.getApplication(marketId, participant).tierReached, 3, "final tier");
    }

    function test_RealAC_RevertWhen_HookNotWhitelisted() public {
        // De-whitelist, then a grade (which calls createJob) must revert at the AC gate.
        agentic.setHookWhitelist(address(echoHook), false);

        uint256 marketId = _createMarket();
        _apply(marketId);

        vm.prank(requester);
        vm.expectRevert(AgenticCommerce.HookNotWhitelisted.selector);
        registry.gradeSubstantive(marketId, participant);
    }

    function test_RealAC_SetAgenticCommerce_Repoints() public {
        // Deploy a second instance and repoint Echo at it (the Path A switch).
        AgenticCommerce acImpl2 = new AgenticCommerce();
        AgenticCommerce ac2 = AgenticCommerce(address(new ERC1967Proxy(
            address(acImpl2),
            abi.encodeWithSelector(AgenticCommerce.initialize.selector, address(usdc), treasury, admin)
        )));
        ac2.setHookWhitelist(address(echoHook), true);

        echoHook.setAgenticCommerce(address(ac2));
        registry.setAgenticCommerce(address(ac2));

        assertEq(address(echoHook.agenticCommerce()), address(ac2));
        assertEq(address(registry.agenticCommerce()), address(ac2));

        // Flow still settles against the new instance.
        uint256 marketId = _createMarket();
        _apply(marketId);
        vm.startPrank(requester);
        registry.gradeSubstantive(marketId, participant);
        vm.stopPrank();
        uint256 jobId = ac2.jobCounter();
        vm.prank(participant);
        ac2.submit(jobId, keccak256("d"), hex"");
        vm.prank(requester);
        ac2.complete(jobId, keccak256("ok"), hex"");
        assertEq(usdc.balanceOf(participant), 4.75e6, "settled via repointed AC");
    }

    // ─── triggerGhost: status-branched penalty (spec-honest worker-protection) ───────────────
    //
    // Both ghost paths share setup: applicant graded to Final, then time elapses past the
    // ghostDeadline without complete() being called. The branching is on the Arc job's status:
    //   - Submitted at deadline → requester ghosted: pay worker, slash requester R-Rep
    //   - Open at deadline → worker ghosted: NO payout, slash worker P-Rep, ghost reserve stays
    //                                          in escrow and refunds on close
    //
    // We assert balances, ghost-state flags, AND that the right event fired (GhostPenalty vs
    // WorkerGhosted) so a future regression in the branch would surface as the wrong event.

    function test_TriggerGhost_RequesterGhosted_WhenJobSubmitted() public {
        uint256 marketId = _createMarket();
        _apply(marketId);

        // Walk up to Final via Substantive → Shortlist → Final, completing each lower-tier job
        // so the lifecycle is realistic. Worker SUBMITS the Final tier but requester never
        // accepts; the ghost deadline elapses → requester-ghost path.
        _gradeSubmitComplete(marketId, 1);
        _gradeSubmitComplete(marketId, 2);

        vm.prank(requester);
        registry.gradeFinal(marketId, participant);
        uint256 finalJobId = agentic.jobCounter();

        // Worker submitted but requester didn't complete.
        vm.prank(participant);
        agentic.submit(finalJobId, keccak256("final-deliverable"), hex"");
        assertEq(uint8(agentic.getJob(finalJobId).status), uint8(AgenticCommerce.JobStatus.Submitted));

        uint256 workerBefore = usdc.balanceOf(participant);

        // Past the ghost deadline.
        vm.warp(block.timestamp + GHOST_DEADLINE + 1);

        // recordLogs over expectEmit so we can be precise about WHICH events from echoHook fired
        // without depending on the order forge inspects them (expectEmit semantics shifted across
        // versions). Asserts: GhostPenalty present, RRepSlashed present, WorkerGhosted absent.
        vm.recordLogs();
        registry.triggerGhost(marketId, participant);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 ghostPenaltyTopic = keccak256("GhostPenalty(uint256,uint256,address,uint256,address)");
        bytes32 rRepSlashedTopic = keccak256("RRepSlashed(uint256,uint256,uint256)");
        bytes32 workerGhostedTopic = keccak256("WorkerGhosted(uint256,uint256,address,uint256)");
        bool sawGhostPenalty;
        bool sawRRepSlashed;
        bool sawWorkerGhosted;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(echoHook)) continue;
            bytes32 t0 = logs[i].topics[0];
            if (t0 == ghostPenaltyTopic) sawGhostPenalty = true;
            else if (t0 == rRepSlashedTopic) sawRRepSlashed = true;
            else if (t0 == workerGhostedTopic) sawWorkerGhosted = true;
        }
        assertTrue(sawGhostPenalty, "GhostPenalty must fire on requester-ghost path");
        assertTrue(sawRRepSlashed, "RRepSlashed must fire on requester-ghost path");
        assertFalse(sawWorkerGhosted, "WorkerGhosted must NOT fire on requester-ghost path");

        assertEq(usdc.balanceOf(participant) - workerBefore, tierAmounts[3], "worker paid ghost amount");
    }

    function test_TriggerGhost_WorkerGhosted_WhenJobStillOpen() public {
        uint256 marketId = _createMarket();
        _apply(marketId);

        _gradeSubmitComplete(marketId, 1);
        _gradeSubmitComplete(marketId, 2);

        vm.prank(requester);
        registry.gradeFinal(marketId, participant);
        uint256 finalJobId = agentic.jobCounter();

        // Worker never submits — job stays Open.
        assertEq(uint8(agentic.getJob(finalJobId).status), uint8(AgenticCommerce.JobStatus.Open));

        uint256 workerBefore = usdc.balanceOf(participant);
        uint256 escrowBefore = usdc.balanceOf(address(echoHook));

        vm.warp(block.timestamp + GHOST_DEADLINE + 1);

        vm.recordLogs();
        registry.triggerGhost(marketId, participant);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 ghostPenaltyTopic = keccak256("GhostPenalty(uint256,uint256,address,uint256,address)");
        bytes32 rRepSlashedTopic = keccak256("RRepSlashed(uint256,uint256,uint256)");
        bytes32 workerGhostedTopic = keccak256("WorkerGhosted(uint256,uint256,address,uint256)");
        bool sawGhostPenalty;
        bool sawRRepSlashed;
        bool sawWorkerGhosted;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(echoHook)) continue;
            bytes32 t0 = logs[i].topics[0];
            if (t0 == ghostPenaltyTopic) sawGhostPenalty = true;
            else if (t0 == rRepSlashedTopic) sawRRepSlashed = true;
            else if (t0 == workerGhostedTopic) sawWorkerGhosted = true;
        }
        assertTrue(sawWorkerGhosted, "WorkerGhosted must fire on worker-ghost path");
        assertFalse(sawGhostPenalty, "GhostPenalty must NOT fire on worker-ghost path");
        assertFalse(sawRRepSlashed, "RRepSlashed must NOT fire on worker-ghost path");

        assertEq(usdc.balanceOf(participant), workerBefore, "worker NOT paid on worker-ghost");
        assertEq(usdc.balanceOf(address(echoHook)), escrowBefore, "escrow untouched on worker-ghost");
    }

    // ─── closeMarket guard + Final-tier revision (worker-protection) ──────────────────────────

    /// @dev Grade through to a SUBMITTED Final job (worker delivered, requester hasn't resolved).
    function _toFinalSubmitted(uint256 marketId) internal returns (uint256 finalJobId) {
        _gradeSubmitComplete(marketId, 1);
        _gradeSubmitComplete(marketId, 2);
        vm.prank(requester);
        registry.gradeFinal(marketId, participant);
        finalJobId = agentic.jobCounter();
        vm.prank(participant);
        agentic.submit(finalJobId, keccak256("final-deliverable"), hex"");
    }

    /// @dev Read the EchoHook ghost deadline for a job out of the public `ctx` mapping (5th field).
    function _ghostDeadline(uint256 jobId) internal view returns (uint256 gd) {
        (, , , , gd, , ) = echoHook.ctx(jobId);
    }

    function test_CloseMarket_Reverts_WhenFinalJobSubmitted() public {
        uint256 marketId = _createMarket();
        _apply(marketId);
        _toFinalSubmitted(marketId);

        vm.prank(requester);
        vm.expectRevert(MarketRegistry.FinalJobStillSubmitted.selector);
        registry.closeMarket(marketId);
    }

    function test_CloseMarket_Succeeds_AfterReject() public {
        uint256 marketId = _createMarket();
        _apply(marketId);
        uint256 finalJobId = _toFinalSubmitted(marketId);

        vm.prank(requester);
        agentic.reject(finalJobId, keccak256("wrong"), hex"");
        assertEq(uint8(agentic.getJob(finalJobId).status), uint8(AgenticCommerce.JobStatus.Rejected));

        vm.prank(requester);
        registry.closeMarket(marketId); // no revert
    }

    function test_RequestRevision_FlipsOpen_ResetsDeadline() public {
        uint256 marketId = _createMarket();
        _apply(marketId);
        uint256 finalJobId = _toFinalSubmitted(marketId);

        vm.prank(requester);
        agentic.requestRevision(finalJobId, hex"");

        assertEq(uint8(agentic.getJob(finalJobId).status), uint8(AgenticCommerce.JobStatus.Open), "back to Open");
        assertTrue(echoHook.revisionUsed(finalJobId), "revisionUsed set");
        assertEq(_ghostDeadline(finalJobId), block.timestamp + 60 minutes, "deadline reset to now+60m");

        // Closing is now allowed (Open, not Submitted) — worker didn't re-submit.
        vm.prank(requester);
        registry.closeMarket(marketId);
    }

    function test_RequestRevision_OnlyEvaluator() public {
        uint256 marketId = _createMarket();
        _apply(marketId);
        uint256 finalJobId = _toFinalSubmitted(marketId);

        vm.prank(participant); // worker is not the evaluator
        vm.expectRevert(AgenticCommerce.Unauthorized.selector);
        agentic.requestRevision(finalJobId, hex"");
    }

    function test_RequestRevision_OncePerJob() public {
        uint256 marketId = _createMarket();
        _apply(marketId);
        uint256 finalJobId = _toFinalSubmitted(marketId);

        vm.prank(requester);
        agentic.requestRevision(finalJobId, hex"");

        // Worker re-submits → Submitted again.
        vm.prank(participant);
        agentic.submit(finalJobId, keccak256("v2"), hex"");

        // Second revision attempt → hook rejects (already used), bubbling up through afterAction.
        vm.prank(requester);
        vm.expectRevert(EchoHook.RevisionAlreadyUsed.selector);
        agentic.requestRevision(finalJobId, hex"");
    }

    function test_ExtendRevision_DecreasingGrants_Max3_ProviderOnly() public {
        uint256 marketId = _createMarket();
        _apply(marketId);
        uint256 finalJobId = _toFinalSubmitted(marketId);

        vm.prank(requester);
        agentic.requestRevision(finalJobId, hex"");
        uint256 base = _ghostDeadline(finalJobId);

        // Non-provider cannot extend.
        vm.prank(requester);
        vm.expectRevert(EchoHook.NotProvider.selector);
        echoHook.extendRevision(finalJobId);

        // Worker extends 3× by 45 / 30 / 15 minutes.
        vm.startPrank(participant);
        echoHook.extendRevision(finalJobId);
        assertEq(_ghostDeadline(finalJobId), base + 45 minutes, "ext1 +45m");
        echoHook.extendRevision(finalJobId);
        assertEq(_ghostDeadline(finalJobId), base + 75 minutes, "ext2 +30m");
        echoHook.extendRevision(finalJobId);
        assertEq(_ghostDeadline(finalJobId), base + 90 minutes, "ext3 +15m");
        assertEq(echoHook.revisionExtensions(finalJobId), 3, "3 extensions used");

        // 4th reverts.
        vm.expectRevert(EchoHook.MaxExtensions.selector);
        echoHook.extendRevision(finalJobId);
        vm.stopPrank();
    }

    function test_ResubmitAfterRevision_ThenAcceptPays() public {
        uint256 marketId = _createMarket();
        _apply(marketId);
        uint256 finalJobId = _toFinalSubmitted(marketId);

        vm.prank(requester);
        agentic.requestRevision(finalJobId, hex"");

        // Worker re-submits the fixed deliverable.
        vm.prank(participant);
        agentic.submit(finalJobId, keccak256("fixed"), hex"");
        assertEq(uint8(agentic.getJob(finalJobId).status), uint8(AgenticCommerce.JobStatus.Submitted));

        uint256 before = usdc.balanceOf(participant);
        vm.prank(requester);
        agentic.complete(finalJobId, keccak256("ok"), hex"");

        // The Final tier job pays tierAmounts[2] (uint8(Tier.Final)-1 == 2); tierAmounts[3] is the
        // ghost reserve, not the accept amount. 250e6 gross, 5% fee → worker nets 237.5e6.
        uint256 expectedNet = tierAmounts[2] * (10000 - FEE_BPS) / 10000;
        assertEq(usdc.balanceOf(participant) - before, expectedNet, "worker paid Final net of fee after revision");
    }

    function test_ExtendRevision_Reverts_WhenNoRevision() public {
        uint256 marketId = _createMarket();
        _apply(marketId);
        uint256 finalJobId = _toFinalSubmitted(marketId);

        // No revision opened yet → cannot extend.
        vm.prank(participant);
        vm.expectRevert(EchoHook.RevisionNotOpen.selector);
        echoHook.extendRevision(finalJobId);
    }
}
