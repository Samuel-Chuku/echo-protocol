// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {AttributionRegistry} from "../core/AttributionRegistry.sol";
import {AttributionPayout} from "../core/AttributionPayout.sol";

/**
 * @title AttributionTest
 * @notice Exercises the AR engine: the anti-sybil confirm gate, the 40%-of-fee ceiling with
 *         pro-rata overflow, and linear decay over 3 years.
 */
contract AttributionTest is Test {
    AttributionRegistry public registry;
    AttributionPayout public payout;

    address public marketRegistry = makeAddr("marketRegistry");
    address public echoHook = makeAddr("echoHook");
    address public sam = makeAddr("sam");       // introduced Dana
    address public tina = makeAddr("tina");     // trained Dana
    address public requesterA = makeAddr("requesterA"); // independent grader

    uint256 constant WORKER = 1;      // Dana's ERC-8004 agent id
    uint16 constant CEILING_BPS = 4000; // 40% of Echo's fee
    uint32 constant THREE_YEARS = uint32(3 * 365 days);
    uint256 constant FEE = 50e6;      // $50 fee on a $1,000 deal

    function setUp() public {
        AttributionRegistry regImpl = new AttributionRegistry();
        AttributionPayout payImpl = new AttributionPayout();

        registry = AttributionRegistry(address(new ERC1967Proxy(address(regImpl), new bytes(0))));
        payout = AttributionPayout(address(new ERC1967Proxy(address(payImpl), new bytes(0))));

        registry.initialize();
        payout.initialize(address(registry), CEILING_BPS);

        registry.setPayout(address(payout));
        registry.setMarketRegistry(marketRegistry);
        payout.setEchoHook(echoHook);
    }

    // ---- helpers ----

    function _propose(address originator, uint16 sliceBps) internal returns (uint256 id) {
        vm.prank(originator);
        id = registry.proposeAR(
            WORKER,
            AttributionRegistry.AttributionType.Introduced,
            sliceBps,
            AttributionRegistry.CurveType.Linear,
            THREE_YEARS,
            0
        );
    }

    function _grade(address requester) internal {
        vm.prank(marketRegistry);
        registry.recordGrade(WORKER, requester);
    }

    function _settle() internal returns (address[] memory r, uint256[] memory a, uint256 total) {
        vm.prank(echoHook);
        (r, a, total) = payout.settle(WORKER, FEE);
    }

    // ---- confirm gate (anti-sybil) ----

    function test_UnconfirmedAR_PaysNothing() public {
        _propose(sam, 1000);
        (, , uint256 total) = _settle();
        assertEq(total, 0, "unconfirmed AR must not pay");
    }

    function test_RevertWhen_ConfirmWithoutGrade() public {
        uint256 id = _propose(sam, 1000);
        vm.expectRevert(AttributionRegistry.NoIndependentGrade.selector);
        registry.confirmAR(id, requesterA); // requesterA hasn't graded Dana
    }

    function test_RevertWhen_OriginatorConfirmsSelf() public {
        uint256 id = _propose(sam, 1000);
        _grade(sam); // even if sam graded, sam == originator is rejected
        vm.expectRevert(AttributionRegistry.NoIndependentGrade.selector);
        registry.confirmAR(id, sam);
    }

    function test_ConfirmWithIndependentGrade() public {
        uint256 id = _propose(sam, 1000);
        _grade(requesterA);
        registry.confirmAR(id, requesterA);

        AttributionRegistry.AR memory a = registry.getAR(id);
        assertTrue(a.confirmed, "AR should be confirmed");
        assertEq(a.startTime, block.timestamp, "startTime set at confirmation");
    }

    // ---- ceiling + pro-rata (the worked example) ----

    function test_CeilingProRata() public {
        // Sam wants 10% of fee = $5; Tina wants 40% of fee = $20; total $25 > $20 ceiling.
        uint256 samId = _propose(sam, 1000);   // 10% of fee
        uint256 tinaId = _propose(tina, 4000); // 40% of fee
        _grade(requesterA);
        registry.confirmAR(samId, requesterA);
        registry.confirmAR(tinaId, requesterA);

        (address[] memory r, uint256[] memory a, uint256 total) = _settle();

        // Pro-rata: Sam 5/25*20 = $4, Tina 20/25*20 = $16, total $20 (40% of $50).
        assertEq(r[0], sam);
        assertEq(a[0], 4e6, "Sam gets $4 after pro-rata");
        assertEq(r[1], tina);
        assertEq(a[1], 16e6, "Tina gets $16 after pro-rata");
        assertEq(total, 20e6, "total attribution == 40% ceiling");
        assertEq(FEE - total, 30e6, "Echo keeps its 60% margin floor");
    }

    function test_UnderCeiling_PaysFull() public {
        // Sam alone wants 10% of fee = $5, well under the $20 ceiling — paid in full.
        uint256 samId = _propose(sam, 1000);
        _grade(requesterA);
        registry.confirmAR(samId, requesterA);

        (, uint256[] memory a, uint256 total) = _settle();
        assertEq(a[0], 5e6, "Sam paid full $5 under ceiling");
        assertEq(total, 5e6);
    }

    // ---- linear decay ----

    function test_LinearDecay_HalfwayHalvesSlice() public {
        uint256 samId = _propose(sam, 1000); // $5 at full slice
        _grade(requesterA);
        registry.confirmAR(samId, requesterA);

        vm.warp(block.timestamp + THREE_YEARS / 2); // halfway through the curve
        (, uint256[] memory a, uint256 total) = _settle();
        assertApproxEqAbs(a[0], 2.5e6, 1e3, "slice halves at the midpoint");
        assertApproxEqAbs(total, 2.5e6, 1e3);
    }

    function test_LinearDecay_ExpiresAtEnd() public {
        uint256 samId = _propose(sam, 1000);
        _grade(requesterA);
        registry.confirmAR(samId, requesterA);

        vm.warp(block.timestamp + THREE_YEARS); // fully decayed
        (, , uint256 total) = _settle();
        assertEq(total, 0, "AR pays nothing after 3 years");
    }

    // ---- volume cap curve ----

    function test_VolumeCap_StopsAtCap() public {
        vm.prank(sam);
        uint256 id = registry.proposeAR(
            WORKER,
            AttributionRegistry.AttributionType.Referred,
            1000,
            AttributionRegistry.CurveType.VolumeCap,
            0,
            7e6 // cap at $7 cumulative
        );
        _grade(requesterA);
        registry.confirmAR(id, requesterA);

        // First deal: wants $5, under cap — paid $5.
        (, uint256[] memory a1,) = _settle();
        assertEq(a1[0], 5e6);

        // Second deal: wants $5 but only $2 of cap remains — clamped to $2.
        (, uint256[] memory a2,) = _settle();
        assertEq(a2[0], 2e6, "clamped to remaining cap");

        // Third deal: cap exhausted — pays nothing.
        (, , uint256 total3) = _settle();
        assertEq(total3, 0, "no payout once cap is hit");
    }
}
