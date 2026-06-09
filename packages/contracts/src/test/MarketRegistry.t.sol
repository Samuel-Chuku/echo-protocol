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
 * @title MarketRegistryTest
 * @notice End-to-end integration tests driving the full Echo lifecycle through mock Arc
 *         primitives: create → apply → grade → settle, plus the fee skim, platform-AR
 *         attribution, requester pool, and close/refund paths.
 */
contract MarketRegistryTest is Test {
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
    address public participant = makeAddr("participant");
    address public sam = makeAddr("sam"); // introduced participant to Echo
    address public treasury = makeAddr("treasury");

    uint256 constant REQ_AGENT = 100;
    uint256 constant PART_AGENT = 200;

    uint256[4] public tierAmounts = [uint256(5e6), 50e6, 250e6, 1000e6]; // Sub/Short/Final/Ghost
    uint16 constant FEE_BPS = 500; // 5%
    uint256 constant MAX_APPLICANTS = 50;
    uint256 constant GHOST_DEADLINE = 7 days;
    uint256 constant ESCROW = 2000e6;

    function setUp() public {
        usdc = new MockUSDC();
        identity = new MockIdentityRegistry();
        reputation = new MockReputationRegistry();
        agentic = new MockAgenticCommerce();

        // Core proxies
        registry = MarketRegistry(address(new ERC1967Proxy(address(new MarketRegistry()), new bytes(0))));
        echoHook = EchoHook(address(new ERC1967Proxy(address(new EchoHook()), new bytes(0))));
        receipts = ParticipationReceipt(address(new ERC1967Proxy(address(new ParticipationReceipt()), new bytes(0))));
        attribution = AttributionRegistry(address(new ERC1967Proxy(address(new AttributionRegistry()), new bytes(0))));
        payout = AttributionPayout(address(new ERC1967Proxy(address(new AttributionPayout()), new bytes(0))));

        // Init
        echoHook.initialize(address(agentic), address(reputation), address(usdc));
        receipts.initialize();
        registry.initialize(address(usdc), address(agentic), address(identity), address(echoHook), address(receipts));
        attribution.initialize();
        payout.initialize(address(attribution), 4000); // 40% ceiling

        // Link
        echoHook.setMarketRegistry(address(registry));
        receipts.setMarketRegistry(address(registry));
        attribution.setPayout(address(payout));
        attribution.setMarketRegistry(address(registry));
        payout.setEchoHook(address(echoHook));
        registry.setAttributionRegistry(address(attribution));
        echoHook.setProtocolConfig(FEE_BPS, treasury, address(payout), address(attribution));

        // Identities
        identity.setAgent(requester, REQ_AGENT);
        identity.setAgent(participant, PART_AGENT);

        // Fund requester
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

    function _apply(uint256 marketId) internal returns (uint256 tokenId) {
        vm.prank(participant);
        tokenId = registry.applyToMarket(marketId, PART_AGENT, keccak256("submission"));
    }

    /// @dev Grade up one tier and immediately settle the spawned job via the mock.
    function _gradeAndSettle(uint256 marketId, uint8 toTier) internal {
        vm.startPrank(requester);
        if (toTier == 1) registry.gradeSubstantive(marketId, participant);
        else if (toTier == 2) registry.gradeShortlist(marketId, participant);
        else if (toTier == 3) registry.gradeFinal(marketId, participant);
        vm.stopPrank();
        // The job just created is the latest one.
        agentic.complete(agentic.jobCount(), keccak256("ok"));
    }

    // ---- create / escrow ----

    function test_CreateMarket_EscrowsToHook() public {
        uint256 marketId = _createMarket();
        assertEq(usdc.balanceOf(address(echoHook)), ESCROW, "escrow held by hook");
        assertEq(echoHook.escrowed(marketId), ESCROW);
        assertEq(echoHook.remainingEscrow(marketId), ESCROW);
    }

    function test_RevertWhen_InsufficientEscrow() public {
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        vm.expectRevert();
        registry.createMarket("uri", keccak256("s"), tierAmounts, 0, MAX_APPLICANTS, GHOST_DEADLINE, 1e6, REQ_AGENT);
        vm.stopPrank();
    }

    // ---- apply ----

    function test_Apply_MintsReceipt() public {
        uint256 marketId = _createMarket();
        uint256 tokenId = _apply(marketId);
        assertEq(receipts.ownerOf(tokenId), participant);
        assertEq(echoHook.escrowed(marketId), ESCROW); // apply doesn't touch escrow
    }

    function test_RevertWhen_ApplyNotAgentOwner() public {
        uint256 marketId = _createMarket();
        address stranger = makeAddr("stranger"); // does not own agentId 999
        vm.prank(stranger);
        vm.expectRevert(MarketRegistry.NotAgentOwner.selector);
        registry.applyToMarket(marketId, 999, keccak256("x"));
    }

    // ---- grade + settle: fee skim ----

    function test_GradeSubstantive_PaysWorkerNetOfFee() public {
        uint256 marketId = _createMarket();
        _apply(marketId);
        _gradeAndSettle(marketId, 1);

        // Substantive gross = $5; fee 5% = $0.25; worker nets $4.75.
        assertEq(usdc.balanceOf(participant), 4.75e6, "worker net of fee");
        // No confirmed AR → entire fee is Echo margin to treasury.
        assertEq(usdc.balanceOf(treasury), 0.25e6, "treasury gets full fee as margin");
    }

    function test_TierProgression_PaysEachTier() public {
        uint256 marketId = _createMarket();
        _apply(marketId);
        _gradeAndSettle(marketId, 1); // $5  → net 4.75
        _gradeAndSettle(marketId, 2); // $50 → net 47.50
        _gradeAndSettle(marketId, 3); // $250→ net 237.50

        assertEq(usdc.balanceOf(participant), 4.75e6 + 47.5e6 + 237.5e6, "cumulative net payouts");
        assertEq(usdc.balanceOf(treasury), 0.25e6 + 2.5e6 + 12.5e6, "cumulative fee margin");

        MarketRegistry.Application memory app = registry.getApplication(marketId, participant);
        assertEq(app.tierReached, 3, "reached final tier");
    }

    // ---- close / refund (bug 1 fix) ----

    function test_CloseMarket_RefundsRemaining() public {
        uint256 marketId = _createMarket();
        _apply(marketId);
        _gradeAndSettle(marketId, 1); // spends $5 gross from escrow

        uint256 beforeBal = usdc.balanceOf(requester);
        uint256 expectedRefund = ESCROW - 5e6;

        vm.prank(requester);
        registry.closeMarket(marketId);

        assertEq(usdc.balanceOf(requester) - beforeBal, expectedRefund, "remaining escrow refunded");
        assertEq(echoHook.remainingEscrow(marketId), 0, "escrow drained");
    }

    // ---- platform attribution (the AR layer) ----

    function test_PlatformAttribution_PaysIntroducerFromFee() public {
        uint256 marketId = _createMarket();
        _apply(marketId);

        // Sam claims he introduced the participant to Echo: 10% of Echo's fee, linear, 3y.
        vm.prank(sam);
        uint256 arId = attribution.proposeAR(
            PART_AGENT, AttributionRegistry.AttributionType.Introduced,
            1000, AttributionRegistry.CurveType.Linear, uint32(3 * 365 days), 0
        );

        // Grade substantive — this records the requester's grade (anti-sybil signal).
        vm.prank(requester);
        registry.gradeSubstantive(marketId, participant);

        // Independent requester confirms Sam's AR.
        attribution.confirmAR(arId, requester);

        // Settle the job.
        agentic.complete(agentic.jobCount(), keccak256("ok"));

        // fee = $0.25; Sam's slice = 10% of fee = $0.025; treasury margin = $0.225.
        assertEq(usdc.balanceOf(sam), 0.025e6, "introducer paid from fee");
        assertEq(usdc.balanceOf(treasury), 0.225e6, "treasury keeps fee remainder");
        assertEq(usdc.balanceOf(participant), 4.75e6, "worker still whole");
    }

    function test_UnconfirmedAR_DoesNotPay() public {
        uint256 marketId = _createMarket();
        _apply(marketId);

        vm.prank(sam);
        attribution.proposeAR(
            PART_AGENT, AttributionRegistry.AttributionType.Introduced,
            1000, AttributionRegistry.CurveType.Linear, uint32(3 * 365 days), 0
        );
        // Never confirmed.
        _gradeAndSettle(marketId, 1);

        assertEq(usdc.balanceOf(sam), 0, "unconfirmed introducer earns nothing");
        assertEq(usdc.balanceOf(treasury), 0.25e6, "full fee to treasury");
    }

    // ---- requester pool ----

    function test_RequesterPool_RewardsIntroducerOnAdvance() public {
        uint256 marketId = _createMarket();
        _apply(marketId);

        // Confirm Sam as the participant's introducer.
        vm.prank(sam);
        uint256 arId = attribution.proposeAR(
            PART_AGENT, AttributionRegistry.AttributionType.Introduced,
            1000, AttributionRegistry.CurveType.Linear, uint32(3 * 365 days), 0
        );
        vm.prank(requester);
        registry.gradeSubstantive(marketId, participant);
        attribution.confirmAR(arId, requester);

        // Requester funds a pool paying introducers 10% of advanced value.
        vm.prank(requester);
        registry.fundAttributionPool(marketId, 100e6, 1000);

        uint256 samBefore = usdc.balanceOf(sam);
        agentic.complete(agentic.jobCount(), keccak256("ok"));

        // Pool reward = 10% of $5 gross = $0.50. Plus platform attribution $0.025 from fee.
        assertEq(echoHook.poolDistributed(marketId), 0.5e6, "pool paid 10% of gross");
        assertEq(usdc.balanceOf(sam) - samBefore, 0.5e6 + 0.025e6, "introducer earns pool + platform");
    }

    function test_CloseMarket_RefundsPoolRemainder() public {
        uint256 marketId = _createMarket();
        vm.prank(requester);
        registry.fundAttributionPool(marketId, 100e6, 1000);

        uint256 beforeBal = usdc.balanceOf(requester);
        vm.prank(requester);
        registry.closeMarket(marketId);

        // Nothing paid from pool → full $100 refunded (plus the untouched escrow).
        assertEq(usdc.balanceOf(requester) - beforeBal, ESCROW + 100e6, "escrow + full pool refunded");
    }
}
