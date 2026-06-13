// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {MarketRegistry} from "../core/MarketRegistry.sol";
import {EchoHook} from "../core/EchoHook.sol";
import {ParticipationReceipt} from "../core/ParticipationReceipt.sol";
import {ValidationGate} from "../core/ValidationGate.sol";
import {AttributionRegistry} from "../core/AttributionRegistry.sol";
import {AttributionPayout} from "../core/AttributionPayout.sol";
import {MockUSDC, MockIdentityRegistry, MockReputationRegistry, MockAgenticCommerce} from "./mocks/Mocks.sol";

/**
 * @title ModeRevealTest
 * @notice P2 (Mode A disclosure + reveal): the atomic reveal entry payment (pay R + refund stake),
 *         the min-reveal escrow binding, the closeMarket reveal-floor guard, shortlist/final tiers
 *         sitting on top of reveal, and the AR overlay earning on reveal payments.
 */
contract ModeRevealTest is Test {
    MarketRegistry public registry;
    EchoHook public echoHook;
    ParticipationReceipt public receipts;
    ValidationGate public gate;
    AttributionRegistry public attribution;
    AttributionPayout public payout;

    MockUSDC public usdc;
    MockIdentityRegistry public identity;
    MockReputationRegistry public reputation;
    MockAgenticCommerce public agentic;

    address public requester = makeAddr("requester");
    address public requester2 = makeAddr("requester2");
    address public participant = makeAddr("participant");
    address public sam = makeAddr("sam");
    address public treasury = makeAddr("treasury");

    uint256 constant REQ_AGENT = 100;
    uint256 constant REQ2_AGENT = 101;
    uint256 constant PART_AGENT = 200;

    uint256[4] public tierAmounts = [uint256(5e6), 50e6, 250e6, 1000e6]; // reveal R = 5e6
    uint16 constant FEE_BPS = 500; // 5%
    uint256 constant MAX_APPLICANTS = 50;
    uint256 constant GHOST_DEADLINE = 7 days;
    uint256 constant ESCROW = 2000e6;
    uint256 constant STAKE = 10e6;
    uint256 constant REVEAL = 5e6;
    uint256 constant FLAG_WINDOW = 2 days;

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

        echoHook.initialize(address(agentic), address(reputation), address(usdc));
        receipts.initialize();
        registry.initialize(address(usdc), address(agentic), address(identity), address(echoHook), address(receipts));
        gate.initialize(address(identity));
        attribution.initialize();
        payout.initialize(address(attribution), 4000);

        echoHook.setMarketRegistry(address(registry));
        receipts.setMarketRegistry(address(registry));
        registry.setValidationGate(address(gate));
        attribution.setPayout(address(payout));
        attribution.setMarketRegistry(address(registry));
        payout.setEchoHook(address(echoHook));
        registry.setAttributionRegistry(address(attribution));
        echoHook.setProtocolConfig(FEE_BPS, treasury, address(payout), address(attribution));

        identity.setAgent(requester, REQ_AGENT);
        identity.setAgent(requester2, REQ2_AGENT);
        identity.setAgent(participant, PART_AGENT);

        usdc.mint(requester, 100_000e6);
        usdc.mint(requester2, 100_000e6);
        usdc.mint(participant, 1_000e6);
    }

    // ---- helpers ----

    function _create(address who, uint256 agentId, uint256 stake) internal returns (uint256 marketId) {
        vm.startPrank(who);
        usdc.approve(address(registry), type(uint256).max);
        marketId = registry.createMarketWithMode(
            "ipfs://m", keccak256("scope"), tierAmounts, 0, MAX_APPLICANTS, GHOST_DEADLINE,
            ESCROW, agentId,
            MarketRegistry.ModeConfig({mode: MarketRegistry.Mode.OpenMarket, requiredProofs: 0, stakeRequired: stake, flagWindow: stake > 0 ? FLAG_WINDOW : 0})
        );
        vm.stopPrank();
    }

    /// @dev After a reveal the stake is held behind the flag window; warp past it and settle to get
    ///      the applicant's stake back (the P6 default-resolve). No-op for stake-free markets.
    function _settleStake(uint256 marketId, address who) internal {
        vm.warp(block.timestamp + FLAG_WINDOW);
        registry.settleRevealStake(marketId, who);
    }

    function _apply(uint256 marketId, address who, uint256 agentId) internal {
        vm.startPrank(who);
        usdc.approve(address(registry), type(uint256).max);
        registry.applyToMarket(marketId, agentId, keccak256("sub"));
        vm.stopPrank();
    }

    function _newWorker(uint256 i) internal returns (address w, uint256 agentId) {
        w = makeAddr(string.concat("w", vm.toString(i)));
        agentId = 1000 + i;
        identity.setAgent(w, agentId);
        usdc.mint(w, 100e6);
    }

    // ---- reveal: atomic pay + stake refund ----

    function test_Reveal_PaysNetFee_HoldsStake_ReducesEscrow() public {
        uint256 marketId = _create(requester, REQ_AGENT, STAKE);
        _apply(marketId, participant, PART_AGENT);

        uint256 partBefore = usdc.balanceOf(participant);
        vm.prank(requester);
        registry.reveal(marketId, participant);

        // R = 5e6, fee 5% = 0.25e6, net 4.75e6. The 10e6 stake is now HELD (P6), not refunded here.
        assertEq(usdc.balanceOf(participant) - partBefore, 4.75e6, "net reveal fee only (stake held)");
        assertEq(usdc.balanceOf(treasury), 0.25e6, "fee margin to treasury (settle path runs on reveal)");
        assertEq(echoHook.stakeBalance(marketId, participant), STAKE, "stake held behind flag window");
        assertEq(echoHook.remainingEscrow(marketId), ESCROW - REVEAL, "escrow reduced by gross R");
        assertEq(registry.revealCount(marketId), 1, "reveal counted");

        MarketRegistry.Application memory app = registry.getApplication(marketId, participant);
        assertEq(app.tierReached, 1, "advanced to reveal tier");

        // After the flag window elapses unflagged, the stake auto-returns to the applicant.
        _settleStake(marketId, participant);
        assertEq(usdc.balanceOf(participant) - partBefore, 4.75e6 + STAKE, "stake returned after window");
        assertEq(echoHook.stakeBalance(marketId, participant), 0, "stake cleared");
    }

    function test_Reveal_ThenShortlistTierOnTop() public {
        uint256 marketId = _create(requester, REQ_AGENT, STAKE);

        uint256 startBal = usdc.balanceOf(participant);
        _apply(marketId, participant, PART_AGENT);

        vm.prank(requester);
        registry.reveal(marketId, participant);

        // Existing shortlist tier still works above reveal (job-based, settles on complete).
        vm.prank(requester);
        registry.gradeShortlist(marketId, participant);
        agentic.complete(agentic.jobCount(), keccak256("ok"));

        MarketRegistry.Application memory app = registry.getApplication(marketId, participant);
        assertEq(app.tierReached, 2, "reached shortlist on top of reveal");
        // The 10e6 stake is deducted at apply and HELD through reveal (P6) — return it via the
        // post-window default-resolve so the delta nets to reveal 4.75 + shortlist 47.5.
        _settleStake(marketId, participant);
        assertEq(usdc.balanceOf(participant) - startBal, 4.75e6 + 47.5e6, "cumulative net payouts");
    }

    // ---- reveal guards ----

    function test_RevertWhen_RevealNotRevealMarket() public {
        // Legacy createMarket ⇒ revealFee == 0.
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        uint256 marketId = registry.createMarket(
            "ipfs://m", keccak256("scope"), tierAmounts, 0, MAX_APPLICANTS, GHOST_DEADLINE, ESCROW, REQ_AGENT
        );
        vm.stopPrank();
        _apply(marketId, participant, PART_AGENT);

        vm.prank(requester);
        vm.expectRevert(MarketRegistry.NotRevealMarket.selector);
        registry.reveal(marketId, participant);
    }

    function test_RevertWhen_RevealTwice() public {
        uint256 marketId = _create(requester, REQ_AGENT, STAKE);
        _apply(marketId, participant, PART_AGENT);
        vm.prank(requester);
        registry.reveal(marketId, participant);

        vm.prank(requester);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistry.InvalidTierTransition.selector, 1, 1));
        registry.reveal(marketId, participant);
    }

    function test_RevertWhen_RevealNotRequester() public {
        uint256 marketId = _create(requester, REQ_AGENT, STAKE);
        _apply(marketId, participant, PART_AGENT);
        vm.prank(sam);
        vm.expectRevert(MarketRegistry.NotRequester.selector);
        registry.reveal(marketId, participant);
    }

    // ---- create-time bindings ----

    function test_RevertWhen_EscrowBelowRevealFloor() public {
        // escrow must be >= R * MIN_REVEALS = 5e6 * 5 = 25e6.
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistry.InsufficientEscrow.selector, 24e6, 25e6));
        registry.createMarketWithMode(
            "ipfs://m", keccak256("scope"), tierAmounts, 0, MAX_APPLICANTS, GHOST_DEADLINE,
            24e6, REQ_AGENT,
            MarketRegistry.ModeConfig({mode: MarketRegistry.Mode.OpenMarket, requiredProofs: 0, stakeRequired: STAKE, flagWindow: FLAG_WINDOW})
        );
        vm.stopPrank();
    }

    function test_RevertWhen_StakeBelowRevealFee() public {
        // stake (if any) must be >= R = 5e6.
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        vm.expectRevert(MarketRegistry.StakeTooSmall.selector);
        registry.createMarketWithMode(
            "ipfs://m", keccak256("scope"), tierAmounts, 0, MAX_APPLICANTS, GHOST_DEADLINE,
            ESCROW, REQ_AGENT,
            MarketRegistry.ModeConfig({mode: MarketRegistry.Mode.OpenMarket, requiredProofs: 0, stakeRequired: 4e6, flagWindow: FLAG_WINDOW})
        );
        vm.stopPrank();
    }

    function test_RevertWhen_StakeWithoutFlagWindow() public {
        // A held stake needs a flag window the requester can flag within (P6, spec §4).
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        vm.expectRevert(MarketRegistry.FlagWindowRequired.selector);
        registry.createMarketWithMode(
            "ipfs://m", keccak256("scope"), tierAmounts, 0, MAX_APPLICANTS, GHOST_DEADLINE,
            ESCROW, REQ_AGENT,
            MarketRegistry.ModeConfig({mode: MarketRegistry.Mode.OpenMarket, requiredProofs: 0, stakeRequired: STAKE, flagWindow: 0})
        );
        vm.stopPrank();
    }

    // ---- closeMarket reveal-floor guard ----

    function test_CloseMarket_BlockedUntilFloor_RefundsUnrevealedStakes() public {
        uint256 marketId = _create(requester, REQ_AGENT, STAKE);

        // 6 workers apply (each stakes 10e6).
        address[6] memory ws;
        uint256[6] memory ids;
        for (uint256 i; i < 6; ++i) {
            (ws[i], ids[i]) = _newWorker(i);
            _apply(marketId, ws[i], ids[i]);
        }

        // Fewer than the floor (min(5,6)=5) revealed ⇒ close blocked.
        vm.prank(requester);
        vm.expectRevert(MarketRegistry.RevealFloorNotMet.selector);
        registry.closeMarket(marketId);

        // Reveal 5; the 6th stays unrevealed.
        for (uint256 i; i < 5; ++i) {
            vm.prank(requester);
            registry.reveal(marketId, ws[i]);
        }

        uint256 leftoverBefore = usdc.balanceOf(ws[5]);
        vm.prank(requester);
        registry.closeMarket(marketId); // floor met

        // The unrevealed 6th worker gets their stake back on close (good-faith, spec §4).
        assertEq(usdc.balanceOf(ws[5]) - leftoverBefore, STAKE, "unrevealed stake refunded on close");
        assertEq(echoHook.stakeBalance(marketId, ws[5]), 0, "stake cleared");
        // Revealed workers' stakes were HELD through reveal (P6) and returned by the same close loop
        // (unflagged holds resolve good-faith on close).
        assertEq(echoHook.stakeBalance(marketId, ws[0]), 0, "revealed held stake returned on close");
    }

    // ---- AR overlay earns on reveal (cross-cutting §8) ----

    function test_Attribution_EarnsOnReveal() public {
        // sam proposes an AR for the worker.
        vm.prank(sam);
        uint256 arId = attribution.proposeAR(
            PART_AGENT, AttributionRegistry.AttributionType.Introduced,
            1000, AttributionRegistry.CurveType.Linear, uint32(3 * 365 days), 0
        );

        // Market 1: requester reveals the worker → records an independent grade.
        uint256 m1 = _create(requester, REQ_AGENT, 0);
        _apply(m1, participant, PART_AGENT);
        vm.prank(requester);
        registry.reveal(m1, participant);

        // The grade confirms sam's AR (independent requester).
        attribution.confirmAR(arId, requester);

        // Market 2: a different requester reveals the same worker → the confirmed AR now pays sam
        // out of the reveal fee, proving the AR overlay earns on reveals (not only completions).
        uint256 m2 = _create(requester2, REQ2_AGENT, 0);
        _apply(m2, participant, PART_AGENT);

        uint256 samBefore = usdc.balanceOf(sam);
        vm.prank(requester2);
        registry.reveal(m2, participant);

        // fee on R=5e6 is 0.25e6; sam's slice = 10% of fee = 0.025e6.
        assertEq(usdc.balanceOf(sam) - samBefore, 0.025e6, "introducer earns from the reveal fee");
    }
}
