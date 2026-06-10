// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {MarketRegistry} from "../core/MarketRegistry.sol";
import {EchoHook} from "../core/EchoHook.sol";
import {ParticipationReceipt} from "../core/ParticipationReceipt.sol";
import {ValidationGate} from "../core/ValidationGate.sol";
import {MockUSDC, MockIdentityRegistry, MockReputationRegistry, MockAgenticCommerce} from "./mocks/Mocks.sol";

/**
 * @title ModeEntryTest
 * @notice P1 (mode + entry foundations): the genesis ValidationGate, per-market mode selection,
 *         and the returnable applicant stake (lock / refund-on-close / admin slash). Drives the
 *         same proxy stack as MarketRegistry.t.sol, additionally wiring the ValidationGate sibling.
 */
contract ModeEntryTest is Test {
    MarketRegistry public registry;
    EchoHook public echoHook;
    ParticipationReceipt public receipts;
    ValidationGate public gate;

    MockUSDC public usdc;
    MockIdentityRegistry public identity;
    MockReputationRegistry public reputation;
    MockAgenticCommerce public agentic;

    address public owner;
    address public requester = makeAddr("requester");
    address public participant = makeAddr("participant");

    uint256 constant REQ_AGENT = 100;
    uint256 constant PART_AGENT = 200;

    uint256[4] public tierAmounts = [uint256(5e6), 50e6, 250e6, 1000e6];
    uint256 constant MAX_APPLICANTS = 50;
    uint256 constant GHOST_DEADLINE = 7 days;
    uint256 constant ESCROW = 2000e6;
    uint256 constant STAKE = 10e6;

    function setUp() public {
        owner = address(this); // deployer owns the proxies

        usdc = new MockUSDC();
        identity = new MockIdentityRegistry();
        reputation = new MockReputationRegistry();
        agentic = new MockAgenticCommerce();

        registry = MarketRegistry(address(new ERC1967Proxy(address(new MarketRegistry()), new bytes(0))));
        echoHook = EchoHook(address(new ERC1967Proxy(address(new EchoHook()), new bytes(0))));
        receipts = ParticipationReceipt(address(new ERC1967Proxy(address(new ParticipationReceipt()), new bytes(0))));
        gate = ValidationGate(address(new ERC1967Proxy(address(new ValidationGate()), new bytes(0))));

        echoHook.initialize(address(agentic), address(reputation), address(usdc));
        receipts.initialize();
        registry.initialize(address(usdc), address(agentic), address(identity), address(echoHook), address(receipts));
        gate.initialize(address(identity));

        echoHook.setMarketRegistry(address(registry));
        receipts.setMarketRegistry(address(registry));
        registry.setValidationGate(address(gate));

        identity.setAgent(requester, REQ_AGENT);
        identity.setAgent(participant, PART_AGENT);

        usdc.mint(requester, 100_000e6);
        usdc.mint(participant, 1_000e6);
    }

    // ---- helpers ----

    function _createModeMarket(MarketRegistry.Mode mode, uint256 requiredProofs, uint256 stake)
        internal
        returns (uint256 marketId)
    {
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        marketId = registry.createMarketWithMode(
            "ipfs://m", keccak256("scope"), tierAmounts, 0, MAX_APPLICANTS, GHOST_DEADLINE,
            ESCROW, REQ_AGENT, mode, requiredProofs, stake
        );
        vm.stopPrank();
    }

    // ---- mode selection / gating ----

    function test_CreateMarketWithMode_StoresOpenMarket() public {
        uint256 marketId = _createModeMarket(MarketRegistry.Mode.OpenMarket, 0, STAKE);
        assertEq(uint8(registry.marketMode(marketId)), uint8(MarketRegistry.Mode.OpenMarket));
        // requiredProofs always OR-ed with PROOF_IDENTITY.
        assertEq(registry.marketRequiredProofs(marketId), registry.PROOF_IDENTITY());
        assertEq(registry.marketStakeRequired(marketId), STAKE);
    }

    function test_RevertWhen_DirectJobMode() public {
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        vm.expectRevert(MarketRegistry.UnsupportedMode.selector);
        registry.createMarketWithMode(
            "ipfs://m", keccak256("scope"), tierAmounts, 0, MAX_APPLICANTS, GHOST_DEADLINE,
            ESCROW, REQ_AGENT, MarketRegistry.Mode.DirectJob, 0, 0
        );
        vm.stopPrank();
    }

    function test_RevertWhen_BountyMode() public {
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        vm.expectRevert(MarketRegistry.UnsupportedMode.selector);
        registry.createMarketWithMode(
            "ipfs://m", keccak256("scope"), tierAmounts, 0, MAX_APPLICANTS, GHOST_DEADLINE,
            ESCROW, REQ_AGENT, MarketRegistry.Mode.Bounty, 0, 0
        );
        vm.stopPrank();
    }

    function test_LegacyCreateMarket_DefaultsToOpenMarketIdentityOnly() public {
        vm.startPrank(requester);
        usdc.approve(address(registry), type(uint256).max);
        uint256 marketId = registry.createMarket(
            "ipfs://m", keccak256("scope"), tierAmounts, 0, MAX_APPLICANTS, GHOST_DEADLINE, ESCROW, REQ_AGENT
        );
        vm.stopPrank();
        assertEq(uint8(registry.marketMode(marketId)), uint8(MarketRegistry.Mode.OpenMarket));
        assertEq(registry.marketRequiredProofs(marketId), registry.PROOF_IDENTITY());
        assertEq(registry.marketStakeRequired(marketId), 0);
    }

    // ---- stake lock ----

    function test_Apply_LocksStake() public {
        uint256 marketId = _createModeMarket(MarketRegistry.Mode.OpenMarket, 0, STAKE);

        uint256 hookBefore = usdc.balanceOf(address(echoHook));
        vm.startPrank(participant);
        usdc.approve(address(registry), type(uint256).max);
        registry.applyToMarket(marketId, PART_AGENT, keccak256("sub"));
        vm.stopPrank();

        assertEq(echoHook.stakeBalance(marketId, participant), STAKE, "stake booked");
        assertEq(usdc.balanceOf(address(echoHook)) - hookBefore, STAKE, "stake custodied in hook");
        // Stake must not pollute escrow accounting.
        assertEq(echoHook.remainingEscrow(marketId), ESCROW, "escrow untouched by stake");
    }

    function test_Apply_NoStakeWhenZero() public {
        uint256 marketId = _createModeMarket(MarketRegistry.Mode.OpenMarket, 0, 0);
        vm.startPrank(participant);
        usdc.approve(address(registry), type(uint256).max);
        registry.applyToMarket(marketId, PART_AGENT, keccak256("sub"));
        vm.stopPrank();
        assertEq(echoHook.stakeBalance(marketId, participant), 0);
    }

    // ---- genesis gate: validation, not reputation ----

    function test_Gate_PassesForIdentityOwner() public {
        uint256 marketId = _createModeMarket(MarketRegistry.Mode.OpenMarket, 0, 0);
        vm.prank(participant);
        registry.applyToMarket(marketId, PART_AGENT, keccak256("sub")); // does not revert
        assertEq(receipts.balanceOf(participant), 1);
    }

    function test_Gate_RevertsWhenRequiredProofUnattested() public {
        // Market demands proof-of-personhood, which the participant has not been attested for.
        uint256 marketId = _createModeMarket(MarketRegistry.Mode.OpenMarket, gate.PROOF_PERSONHOOD(), 0);
        vm.prank(participant);
        vm.expectRevert(MarketRegistry.ValidationFailed.selector);
        registry.applyToMarket(marketId, PART_AGENT, keccak256("sub"));
    }

    function test_Gate_PassesAfterAttestation() public {
        uint256 marketId = _createModeMarket(MarketRegistry.Mode.OpenMarket, gate.PROOF_PERSONHOOD(), 0);

        // Owner authorizes an attester (the World ID / KYC adapter slot), who attests the agent.
        address attester = makeAddr("worldIdAdapter");
        uint256 personhood = gate.PROOF_PERSONHOOD(); // read before prank (prank applies to next call)
        gate.setAttester(attester, true);
        vm.prank(attester);
        gate.attest(PART_AGENT, personhood);

        vm.prank(participant);
        registry.applyToMarket(marketId, PART_AGENT, keccak256("sub")); // now passes
        assertEq(receipts.balanceOf(participant), 1);
    }

    function test_Gate_RevertsForNonOwnerOfAgent() public {
        uint256 marketId = _createModeMarket(MarketRegistry.Mode.OpenMarket, 0, 0);
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(MarketRegistry.ValidationFailed.selector);
        registry.applyToMarket(marketId, PART_AGENT, keccak256("sub")); // stranger doesn't own PART_AGENT
    }

    // ---- stake resolution + the P2 reveal-floor binding on close ----

    function test_CloseMarket_BlockedByRevealFloorThenAllowed() public {
        uint256 marketId = _createModeMarket(MarketRegistry.Mode.OpenMarket, 0, STAKE);
        vm.startPrank(participant);
        usdc.approve(address(registry), type(uint256).max);
        registry.applyToMarket(marketId, PART_AGENT, keccak256("sub"));
        vm.stopPrank();

        // One applicant ⇒ floor = min(5,1) = 1. Closing without revealing is the harvest-and-refund
        // attack the binding forbids.
        vm.prank(requester);
        vm.expectRevert(MarketRegistry.RevealFloorNotMet.selector);
        registry.closeMarket(marketId);

        // Revealing meets the floor AND refunds the stake atomically; then close succeeds.
        uint256 partBefore = usdc.balanceOf(participant);
        vm.prank(requester);
        registry.reveal(marketId, participant);
        assertEq(echoHook.stakeBalance(marketId, participant), 0, "stake refunded at reveal");

        vm.prank(requester);
        registry.closeMarket(marketId);
        // Stake came back at reveal; reveal fee net of 0% fee (no protocol config wired here).
        assertGt(usdc.balanceOf(participant), partBefore, "worker paid reveal fee + stake");
    }

    // ---- stake resolution: admin slash (placeholder for P5/P6) ----

    function test_AdminSlashStake_RoutesToRequester() public {
        uint256 marketId = _createModeMarket(MarketRegistry.Mode.OpenMarket, 0, STAKE);
        vm.startPrank(participant);
        usdc.approve(address(registry), type(uint256).max);
        registry.applyToMarket(marketId, PART_AGENT, keccak256("sub"));
        vm.stopPrank();

        uint256 reqBefore = usdc.balanceOf(requester);
        registry.adminSlashStake(marketId, participant); // owner == this test
        assertEq(usdc.balanceOf(requester) - reqBefore, STAKE, "slashed stake to requester");
        assertEq(echoHook.stakeBalance(marketId, participant), 0, "stake cleared");
    }

    function test_RevertWhen_NonOwnerSlashes() public {
        uint256 marketId = _createModeMarket(MarketRegistry.Mode.OpenMarket, 0, STAKE);
        vm.startPrank(participant);
        usdc.approve(address(registry), type(uint256).max);
        registry.applyToMarket(marketId, PART_AGENT, keccak256("sub"));
        vm.stopPrank();

        vm.prank(requester); // not the protocol owner
        vm.expectRevert();
        registry.adminSlashStake(marketId, participant);
    }

    // ---- stake-only EchoHook guards ----

    function test_RevertWhen_LockStakeNotRegistry() public {
        vm.expectRevert(EchoHook.NotMarketRegistry.selector);
        echoHook.lockStake(1, participant, STAKE);
    }
}
