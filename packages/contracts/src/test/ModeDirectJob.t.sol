// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {MarketRegistry} from "../core/MarketRegistry.sol";
import {EchoHook} from "../core/EchoHook.sol";
import {ParticipationReceipt} from "../core/ParticipationReceipt.sol";
import {AttributionRegistry} from "../core/AttributionRegistry.sol";
import {AttributionPayout} from "../core/AttributionPayout.sol";
import {MockUSDC, MockIdentityRegistry, MockReputationRegistry, MockAgenticCommerce} from "./mocks/Mocks.sol";

/**
 * @title ModeDirectJobTest
 * @notice P3 (Mode B — Direct Job + milestones): create/escrow, per-milestone submit → accept or
 *         auto-release, the exit-theft guard (silence auto-releases), and cancel refunding only
 *         un-submitted milestones (no clawback of delivered work).
 */
contract ModeDirectJobTest is Test {
    MarketRegistry public registry;
    EchoHook public echoHook;
    ParticipationReceipt public receipts;
    AttributionRegistry public attribution;
    AttributionPayout public payout;

    MockUSDC public usdc;
    MockIdentityRegistry public identity;
    MockReputationRegistry public reputation;
    MockAgenticCommerce public agentic;

    address public requester = makeAddr("requester");
    address public worker = makeAddr("worker");
    address public stranger = makeAddr("stranger");
    address public treasury = makeAddr("treasury");

    uint256 constant REQ_AGENT = 100;
    uint256 constant WORKER_AGENT = 200;

    uint16 constant FEE_BPS = 500; // 5%
    uint256 constant REVIEW_WINDOW = 3 days;

    function setUp() public {
        usdc = new MockUSDC();
        identity = new MockIdentityRegistry();
        reputation = new MockReputationRegistry();
        agentic = new MockAgenticCommerce();

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

        identity.setAgent(requester, REQ_AGENT);
        identity.setAgent(worker, WORKER_AGENT);

        usdc.mint(requester, 100_000e6);
    }

    // ---- helpers ----

    function _amounts() internal pure returns (uint256[] memory a) {
        a = new uint256[](3);
        a[0] = 100e6;
        a[1] = 200e6;
        a[2] = 300e6; // total 600e6
    }

    function _create() internal returns (uint256 marketId) {
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        marketId = registry.createDirectJob(
            worker, WORKER_AGENT, REQ_AGENT, "ipfs://job", keccak256("scope"), _amounts(), REVIEW_WINDOW
        );
        vm.stopPrank();
    }

    // ---- create / escrow ----

    function test_CreateDirectJob_EscrowsTotal_StoresMilestones() public {
        uint256 marketId = _create();
        assertEq(uint8(registry.marketMode(marketId)), uint8(MarketRegistry.Mode.DirectJob));
        assertEq(usdc.balanceOf(address(echoHook)), 600e6, "full escrow held");
        assertEq(echoHook.remainingEscrow(marketId), 600e6);

        MarketRegistry.Milestone[] memory ms = registry.getDirectJobMilestones(marketId);
        assertEq(ms.length, 3);
        assertEq(ms[0].amount, 100e6);
        assertEq(uint8(ms[0].status), uint8(MarketRegistry.MilestoneStatus.Pending));
    }

    function test_RevertWhen_NoMilestones() public {
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        vm.expectRevert(MarketRegistry.NoMilestones.selector);
        registry.createDirectJob(worker, WORKER_AGENT, REQ_AGENT, "u", keccak256("s"), new uint256[](0), REVIEW_WINDOW);
        vm.stopPrank();
    }

    function test_SingleShotJob() public {
        uint256[] memory a = new uint256[](1);
        a[0] = 250e6;
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        uint256 marketId = registry.createDirectJob(worker, WORKER_AGENT, REQ_AGENT, "u", keccak256("s"), a, REVIEW_WINDOW);
        vm.stopPrank();

        vm.prank(worker);
        registry.submitMilestone(marketId, 0, keccak256("deliverable"));
        vm.prank(requester);
        registry.acceptMilestone(marketId, 0);
        assertEq(usdc.balanceOf(worker), 237.5e6, "single milestone net of 5% fee");
    }

    // ---- submit → accept ----

    function test_SubmitThenAccept_PaysWorkerNetOfFee() public {
        uint256 marketId = _create();

        vm.prank(worker);
        registry.submitMilestone(marketId, 0, keccak256("d0"));
        vm.prank(requester);
        registry.acceptMilestone(marketId, 0);

        // 100e6 gross, 5% fee → worker 95e6, treasury 5e6, escrow 600-100=500.
        assertEq(usdc.balanceOf(worker), 95e6, "worker net of fee");
        assertEq(usdc.balanceOf(treasury), 5e6, "fee margin to treasury");
        assertEq(echoHook.remainingEscrow(marketId), 500e6, "escrow reduced by milestone gross");

        MarketRegistry.Milestone[] memory ms = registry.getDirectJobMilestones(marketId);
        assertEq(uint8(ms[0].status), uint8(MarketRegistry.MilestoneStatus.Released));
    }

    function test_MilestonesAreIndependent() public {
        uint256 marketId = _create();
        vm.startPrank(worker);
        registry.submitMilestone(marketId, 2, keccak256("d2"));
        vm.stopPrank();
        vm.prank(requester);
        registry.acceptMilestone(marketId, 2);

        assertEq(usdc.balanceOf(worker), 285e6, "milestone 2 net (300 - 5%)");
        MarketRegistry.Milestone[] memory ms = registry.getDirectJobMilestones(marketId);
        assertEq(uint8(ms[0].status), uint8(MarketRegistry.MilestoneStatus.Pending), "others untouched");
        assertEq(uint8(ms[2].status), uint8(MarketRegistry.MilestoneStatus.Released));
    }

    // ---- auto-release (exit-theft guard) ----

    function test_AutoRelease_AfterWindow_AnyoneCanTrigger() public {
        uint256 marketId = _create();
        vm.prank(worker);
        registry.submitMilestone(marketId, 1, keccak256("d1"));

        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        vm.prank(stranger); // not the requester — silence must not profit the silent party
        registry.autoReleaseMilestone(marketId, 1);

        assertEq(usdc.balanceOf(worker), 190e6, "milestone 1 auto-released net (200 - 5%)");
    }

    function test_RevertWhen_AutoReleaseBeforeWindow() public {
        uint256 marketId = _create();
        vm.prank(worker);
        registry.submitMilestone(marketId, 1, keccak256("d1"));

        vm.expectRevert(MarketRegistry.ReviewWindowNotElapsed.selector);
        registry.autoReleaseMilestone(marketId, 1);
    }

    function test_RevertWhen_AutoReleaseNotSubmitted() public {
        uint256 marketId = _create();
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        vm.expectRevert(MarketRegistry.MilestoneNotSubmitted.selector);
        registry.autoReleaseMilestone(marketId, 0); // never submitted
    }

    // ---- cancel ----

    function test_Cancel_RefundsOnlyPending_SubmittedStaysClaimable() public {
        uint256 marketId = _create();

        // Worker submits milestone 0; milestones 1,2 remain Pending.
        vm.prank(worker);
        registry.submitMilestone(marketId, 0, keccak256("d0"));

        uint256 reqBefore = usdc.balanceOf(requester);
        vm.prank(requester);
        registry.cancelDirectJob(marketId);

        // Refund = pending (200 + 300) = 500; submitted milestone 0 (100) stays funded.
        assertEq(usdc.balanceOf(requester) - reqBefore, 500e6, "only pending milestones refunded");
        assertEq(echoHook.remainingEscrow(marketId), 100e6, "submitted milestone still escrowed");

        // The worker is still protected: they can auto-release the delivered milestone after the window.
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        registry.autoReleaseMilestone(marketId, 0);
        assertEq(usdc.balanceOf(worker), 95e6, "delivered work paid out despite cancel");
        assertEq(echoHook.remainingEscrow(marketId), 0, "escrow fully resolved");
    }

    function test_RevertWhen_SubmitAfterCancel() public {
        uint256 marketId = _create();
        vm.prank(requester);
        registry.cancelDirectJob(marketId);
        vm.prank(worker);
        vm.expectRevert(MarketRegistry.JobCancelled.selector);
        registry.submitMilestone(marketId, 0, keccak256("d0"));
    }

    function test_RevertWhen_CancelTwice() public {
        uint256 marketId = _create();
        vm.startPrank(requester);
        registry.cancelDirectJob(marketId);
        vm.expectRevert(MarketRegistry.JobCancelled.selector);
        registry.cancelDirectJob(marketId);
        vm.stopPrank();
    }

    // ---- access / state guards ----

    function test_RevertWhen_SubmitNotWorker() public {
        uint256 marketId = _create();
        vm.prank(stranger);
        vm.expectRevert(MarketRegistry.NotWorker.selector);
        registry.submitMilestone(marketId, 0, keccak256("d0"));
    }

    function test_RevertWhen_AcceptNotRequester() public {
        uint256 marketId = _create();
        vm.prank(worker);
        registry.submitMilestone(marketId, 0, keccak256("d0"));
        vm.prank(stranger);
        vm.expectRevert(MarketRegistry.NotRequester.selector);
        registry.acceptMilestone(marketId, 0);
    }

    function test_RevertWhen_AcceptNotSubmitted() public {
        uint256 marketId = _create();
        vm.prank(requester);
        vm.expectRevert(MarketRegistry.MilestoneNotSubmitted.selector);
        registry.acceptMilestone(marketId, 0); // still Pending
    }

    function test_RevertWhen_BadMilestoneIndex() public {
        uint256 marketId = _create();
        vm.prank(worker);
        vm.expectRevert(MarketRegistry.BadMilestoneIndex.selector);
        registry.submitMilestone(marketId, 9, keccak256("d"));
    }

    function test_RevertWhen_DirectJobOpOnFunnelMarket() public {
        // A legacy funnel market is not a direct job; Mode B ops must reject it.
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        uint256[4] memory tiers = [uint256(5e6), 50e6, 250e6, 1000e6];
        uint256 funnelId = registry.createMarket("u", keccak256("s"), tiers, 0, 50, 7 days, 2000e6, REQ_AGENT);
        vm.stopPrank();

        vm.prank(worker);
        vm.expectRevert(MarketRegistry.NotDirectJob.selector);
        registry.submitMilestone(funnelId, 0, keccak256("d"));
    }

    function test_RevertWhen_CreateMarketWithModeStillRejectsDirectJob() public {
        // Mode B is created via createDirectJob, NOT the funnel creator — which still guards it.
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        uint256[4] memory tiers = [uint256(5e6), 50e6, 250e6, 1000e6];
        vm.expectRevert(MarketRegistry.UnsupportedMode.selector);
        registry.createMarketWithMode("u", keccak256("s"), tiers, 0, 50, 7 days, 2000e6, REQ_AGENT, MarketRegistry.Mode.DirectJob, 0, 0);
        vm.stopPrank();
    }
}
