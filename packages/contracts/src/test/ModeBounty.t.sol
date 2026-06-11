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
 * @title ModeBountyTest
 * @notice P4 (Mode Bounty — open submissions, parallel winners): create/pool, exposed findings via
 *         the genesis gate, parallel accept (multiple winners) with the defaultAward floor, reject,
 *         ignore-theft auto-escalation, and no-reclaim-while-pending on close.
 */
contract ModeBountyTest is Test {
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
    address public treasury = makeAddr("treasury");

    uint256 constant REQ_AGENT = 100;
    uint16 constant FEE_BPS = 500; // 5%
    uint256 constant POOL = 1000e6;
    uint256 constant DEFAULT_AWARD = 50e6;
    uint256 constant REVIEW_WINDOW = 5 days;

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
        usdc.mint(requester, 100_000e6);
    }

    // ---- helpers ----

    function _create() internal returns (uint256 marketId) {
        return _createWithProofs(0);
    }

    function _createWithProofs(uint256 requiredProofs) internal returns (uint256 marketId) {
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        marketId = registry.createBounty(
            REQ_AGENT, "ipfs://bounty", keccak256("scope"), requiredProofs, DEFAULT_AWARD, REVIEW_WINDOW, POOL
        );
        vm.stopPrank();
    }

    function _submitter(uint256 i) internal returns (address s, uint256 agentId) {
        s = makeAddr(string.concat("s", vm.toString(i)));
        agentId = 2000 + i;
        identity.setAgent(s, agentId);
    }

    function _submit(uint256 marketId, address s, uint256 agentId) internal returns (uint256 index) {
        vm.prank(s);
        index = registry.submitFinding(marketId, agentId, keccak256(abi.encode(s)));
    }

    // ---- create / pool ----

    function test_CreateBounty_EscrowsPool() public {
        uint256 marketId = _create();
        assertEq(uint8(registry.marketMode(marketId)), uint8(MarketRegistry.Mode.Bounty));
        assertEq(usdc.balanceOf(address(echoHook)), POOL, "pool escrowed");
        assertEq(echoHook.remainingEscrow(marketId), POOL);
    }

    function test_RevertWhen_PoolBelowDefaultAward() public {
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistry.InsufficientEscrow.selector, 10e6, 50e6));
        registry.createBounty(REQ_AGENT, "u", keccak256("s"), 0, DEFAULT_AWARD, REVIEW_WINDOW, 10e6);
        vm.stopPrank();
    }

    // ---- submit (exposed, gated) ----

    function test_SubmitFinding_OpenToGatedSubmitters() public {
        uint256 marketId = _create();
        (address s, uint256 id) = _submitter(1);
        uint256 idx = _submit(marketId, s, id);
        assertEq(idx, 0);

        MarketRegistry.Finding[] memory fs = registry.getBountyFindings(marketId);
        assertEq(fs.length, 1);
        assertEq(fs[0].submitter, s);
        assertEq(uint8(fs[0].status), uint8(MarketRegistry.FindingStatus.Pending));
        assertEq(registry.bountyPendingCount(marketId), 1);
    }

    function test_RevertWhen_SubmitFailsGate() public {
        uint256 marketId = _createWithProofs(gate.PROOF_KYC());
        (address s, uint256 id) = _submitter(1); // not KYC-attested
        vm.prank(s);
        vm.expectRevert(MarketRegistry.ValidationFailed.selector);
        registry.submitFinding(marketId, id, keccak256("f"));
    }

    function test_OneSubmitterManyFindings() public {
        uint256 marketId = _create();
        (address s, uint256 id) = _submitter(1);
        _submit(marketId, s, id);
        _submit(marketId, s, id);
        assertEq(registry.bountyPendingCount(marketId), 2, "same submitter can post many findings");
    }

    // ---- accept: parallel winners + floor ----

    function test_AcceptFindings_ParallelWinners() public {
        uint256 marketId = _create();
        (address s1, uint256 id1) = _submitter(1);
        (address s2, uint256 id2) = _submitter(2);
        _submit(marketId, s1, id1);
        _submit(marketId, s2, id2);

        // Two parallel winners, different award amounts (both >= floor).
        vm.startPrank(requester);
        registry.acceptFinding(marketId, 0, 50e6);
        registry.acceptFinding(marketId, 1, 200e6);
        vm.stopPrank();

        // 5% fee: s1 nets 47.5, s2 nets 190.
        assertEq(usdc.balanceOf(s1), 47.5e6, "winner 1 net of fee");
        assertEq(usdc.balanceOf(s2), 190e6, "winner 2 net of fee");
        assertEq(echoHook.remainingEscrow(marketId), POOL - 250e6, "pool drawn by both awards");
        assertEq(registry.bountyPendingCount(marketId), 0, "both resolved");
    }

    function test_RevertWhen_AwardBelowFloor() public {
        uint256 marketId = _create();
        (address s, uint256 id) = _submitter(1);
        _submit(marketId, s, id);
        vm.prank(requester);
        vm.expectRevert(MarketRegistry.AwardBelowFloor.selector);
        registry.acceptFinding(marketId, 0, 49e6);
    }

    function test_RevertWhen_AwardExceedsPool() public {
        uint256 marketId = _create();
        (address s, uint256 id) = _submitter(1);
        _submit(marketId, s, id);
        vm.prank(requester);
        vm.expectRevert(MarketRegistry.AwardExceedsPool.selector);
        registry.acceptFinding(marketId, 0, POOL + 1);
    }

    function test_RevertWhen_AcceptNotRequester() public {
        uint256 marketId = _create();
        (address s, uint256 id) = _submitter(1);
        _submit(marketId, s, id);
        vm.prank(s);
        vm.expectRevert(MarketRegistry.NotRequester.selector);
        registry.acceptFinding(marketId, 0, 50e6);
    }

    // ---- reject ----

    function test_RejectFinding_FreeAndUnblocksClose() public {
        uint256 marketId = _create();
        (address s, uint256 id) = _submitter(1);
        _submit(marketId, s, id);

        vm.prank(requester);
        registry.rejectFinding(marketId, 0);
        assertEq(registry.bountyPendingCount(marketId), 0, "reject clears pending");
        assertEq(usdc.balanceOf(s), 0, "rejected finding pays nothing");

        MarketRegistry.Finding[] memory fs = registry.getBountyFindings(marketId);
        assertEq(uint8(fs[0].status), uint8(MarketRegistry.FindingStatus.Rejected));
    }

    // ---- auto-escalation (ignore-theft guard) ----

    function test_AutoEscalate_AfterWindow_AnyoneCanTrigger() public {
        uint256 marketId = _create();
        (address s, uint256 id) = _submitter(1);
        _submit(marketId, s, id);

        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        address anyone = makeAddr("anyone");
        vm.prank(anyone);
        registry.autoEscalateFinding(marketId, 0);

        // Ignored finding force-accepted for defaultAward (50e6), net of 5% fee = 47.5.
        assertEq(usdc.balanceOf(s), 47.5e6, "ignored finding auto-paid the floor");
        assertEq(registry.bountyPendingCount(marketId), 0);
    }

    function test_RevertWhen_AutoEscalateBeforeWindow() public {
        uint256 marketId = _create();
        (address s, uint256 id) = _submitter(1);
        _submit(marketId, s, id);
        vm.expectRevert(MarketRegistry.ReviewWindowNotElapsed.selector);
        registry.autoEscalateFinding(marketId, 0);
    }

    function test_AutoEscalate_CappedAtRemainingPool() public {
        // Pool just above the floor; first accept drains most, escalation caps at the dust left.
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        uint256 marketId = registry.createBounty(REQ_AGENT, "u", keccak256("s"), 0, DEFAULT_AWARD, REVIEW_WINDOW, 60e6);
        vm.stopPrank();

        (address s1, uint256 id1) = _submitter(1);
        (address s2, uint256 id2) = _submitter(2);
        _submit(marketId, s1, id1);
        _submit(marketId, s2, id2);

        vm.prank(requester);
        registry.acceptFinding(marketId, 0, 50e6); // pool now 10e6 left, below the 50e6 floor

        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        registry.autoEscalateFinding(marketId, 1); // caps at remaining 10e6
        assertEq(usdc.balanceOf(s2), 9.5e6, "escalation capped at remaining pool, net of fee");
        assertEq(echoHook.remainingEscrow(marketId), 0, "pool fully drawn");
    }

    // ---- no-reclaim-while-pending ----

    function test_RevertWhen_CloseWithPendingFindings() public {
        uint256 marketId = _create();
        (address s, uint256 id) = _submitter(1);
        _submit(marketId, s, id);

        vm.prank(requester);
        vm.expectRevert(MarketRegistry.FindingsStillPending.selector);
        registry.closeBounty(marketId);
    }

    function test_CloseBounty_RefundsRemainderOncePendingCleared() public {
        uint256 marketId = _create();
        (address s1, uint256 id1) = _submitter(1);
        (address s2, uint256 id2) = _submitter(2);
        _submit(marketId, s1, id1);
        _submit(marketId, s2, id2);

        vm.startPrank(requester);
        registry.acceptFinding(marketId, 0, 100e6); // pays 100 gross
        registry.rejectFinding(marketId, 1);        // free

        uint256 before = usdc.balanceOf(requester);
        registry.closeBounty(marketId);             // refund POOL - 100
        vm.stopPrank();

        assertEq(usdc.balanceOf(requester) - before, POOL - 100e6, "unspent pool refunded");
        assertEq(echoHook.remainingEscrow(marketId), 0, "pool resolved");
    }

    // ---- mode guards ----

    function test_RevertWhen_BountyOpOnFunnelMarket() public {
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        uint256[4] memory tiers = [uint256(5e6), 50e6, 250e6, 1000e6];
        uint256 funnelId = registry.createMarket("u", keccak256("s"), tiers, 0, 50, 7 days, 2000e6, REQ_AGENT);
        vm.stopPrank();

        (address s, uint256 id) = _submitter(1);
        vm.prank(s);
        vm.expectRevert(MarketRegistry.NotBounty.selector);
        registry.submitFinding(funnelId, id, keccak256("f"));
    }

    function test_RevertWhen_CreateMarketWithModeStillRejectsBounty() public {
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        uint256[4] memory tiers = [uint256(5e6), 50e6, 250e6, 1000e6];
        vm.expectRevert(MarketRegistry.UnsupportedMode.selector);
        registry.createMarketWithMode("u", keccak256("s"), tiers, 0, 50, 7 days, 2000e6, REQ_AGENT, MarketRegistry.Mode.Bounty, 0, 0);
        vm.stopPrank();
    }
}
