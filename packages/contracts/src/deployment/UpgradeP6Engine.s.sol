// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {MarketRegistry} from "../core/MarketRegistry.sol";
import {EchoHook} from "../core/EchoHook.sol";
import {DisputeResolver} from "../core/DisputeResolver.sol";

/**
 * @title UpgradeP6Engine
 * @notice P6 (Engine unification + reputation, spec §8) deployment. Three in-place impl upgrades on
 *         the existing proxies — no new siblings — plus one owner flip:
 *
 *           1. MarketRegistry impl. Adds the Mode-A reveal stake-hold: reveal() now HOLDS the
 *              applicant stake behind a per-market flag window (ModeConfig.flagWindow) instead of
 *              refunding it atomically; settleRevealStake (permissionless default-resolve),
 *              markRevealFlagged + resolveStakeDispute (resolver-gated). The stake-hold lifecycle is
 *              extracted into the NEW EchoReveal delegatecall library (size relief — same pattern as
 *              P5's EchoBounty/EchoDirectJob, keeps via_ir OFF). createMarketWithMode now takes a
 *              ModeConfig calldata struct (was 11 flat args) — non-IR ABI-decoder stack relief.
 *              `forge script` auto-deploys + links EchoReveal (and re-links EchoBounty/EchoDirectJob,
 *              whose settle calls changed) into the new impl in this same run.
 *
 *           2. EchoHook impl. Reputation now reflects HOW a payout resolved: a silence-driven
 *              auto-resolve (auto-escalate / auto-release / dispute-overruled) credits the worker but
 *              NOT the silent requester; slashStake writes the applicant's -1 "bait_sustained" P-Rep.
 *              No EchoHook STORAGE change (only function signatures + reputation logic).
 *
 *           3. DisputeResolver impl. The ModeAStake subject is now live: openStakeDispute flags the
 *              reveal on the market (requester = opener/slash-seeker), resolve uses a subject-aware
 *              tie-break (ModeAStake needs a STRICT majority to slash) and drives resolveStakeDispute
 *              (slash → requester / clear → applicant). No DisputeResolver STORAGE change.
 *
 *           4. Owner flip: resolver.setModeAStakeEnabled(true) — turns the now-backed stake subject on.
 *
 * @dev DRY-RUN BY DEFAULT. forge sends only with --broadcast. All three upgradeToAndCall + the flip
 *      are onlyOwner — simulate as the owner (--sender) and broadcast with the owner keystore.
 *
 * STORAGE SAFETY (verify before broadcasting):
 *   forge clean
 *   forge inspect src/core/MarketRegistry.sol:MarketRegistry storageLayout
 *     # slots 0-22 IDENTICAL to live P5; revealFlagWindow appended at slot 23, revealHolds at slot 24.
 *     # revealHolds' element type is EchoReveal.RevealHold (a type rename of the inline struct) —
 *     # a source-level change with identical layout. If any existing slot moved, DO NOT upgrade.
 *   forge inspect src/core/EchoHook.sol:EchoHook storageLayout        # unchanged from P5
 *   forge inspect src/core/DisputeResolver.sol:DisputeResolver storageLayout  # unchanged from P5
 *
 * SEAT THE JURY (separate owner ops, still pending from P5): setJuror(addr,true) for the real panel
 *   + setAgentOracle(addr). Disputes can be opened/countered with an empty panel but not voted/
 *   resolved. Left out of this script (no canonical addresses); run as owner txs.
 *
 * Usage (dry run):
 *   set -x ARC_TESTNET_RPC_URL "https://rpc.testnet.arc.network"
 *   forge script src/deployment/UpgradeP6Engine.s.sol:UpgradeP6Engine \
 *     --rpc-url $ARC_TESTNET_RPC_URL --sender <OWNER_ADDRESS>
 *
 * Usage (real upgrade — owner keystore):
 *   forge script src/deployment/UpgradeP6Engine.s.sol:UpgradeP6Engine \
 *     --rpc-url $ARC_TESTNET_RPC_URL --account echo-deployer --broadcast
 *
 * AFTER a real run: record the new MarketRegistry / EchoHook / DisputeResolver impls + the EchoReveal
 * (and re-linked EchoBounty/EchoDirectJob) library addresses (broadcast/ run log) in
 * packages/sdk/src/constants.ts (IMPLEMENTATIONS + LIBRARIES).
 */
contract UpgradeP6Engine is Script {
    // --- Live proxies (canonical, unchanged) ---
    address constant MARKET_REGISTRY_PROXY  = 0x6CE0899056cB7e36524703289Da66A8ED0e333dc;
    address constant ECHO_HOOK_PROXY        = 0x6333b42426e5684BdB696BE2fF302AD5cfc84866;
    address constant DISPUTE_RESOLVER_PROXY = 0x8d04351F57C4BF2089B2F1E53dBe569e3AeF8EC8;

    function run() external {
        console.log("=== Echo P6: Engine unification + reputation (spec");
        console.log("    section 8) ===");

        vm.startBroadcast();

        // (1) New MarketRegistry impl. forge auto-deploys + links EchoReveal (new) and re-links
        //     EchoBounty + EchoDirectJob (their settle calls changed) into this impl.
        MarketRegistry newRegistryImpl = new MarketRegistry();
        MarketRegistry(MARKET_REGISTRY_PROXY).upgradeToAndCall(address(newRegistryImpl), "");
        console.log("MarketRegistry NEW impl:  ", address(newRegistryImpl));

        // (2) New EchoHook impl (reputation taxonomy + slashStake -1 P-Rep). No storage change.
        EchoHook newHookImpl = new EchoHook();
        EchoHook(ECHO_HOOK_PROXY).upgradeToAndCall(address(newHookImpl), "");
        console.log("EchoHook NEW impl:        ", address(newHookImpl));

        // (3) New DisputeResolver impl (live ModeAStake subject + subject-aware tie-break).
        DisputeResolver newResolverImpl = new DisputeResolver();
        DisputeResolver(DISPUTE_RESOLVER_PROXY).upgradeToAndCall(address(newResolverImpl), "");
        console.log("DisputeResolver NEW impl: ", address(newResolverImpl));

        // (4) Turn on the now-backed Mode-A stake dispute subject.
        DisputeResolver(DISPUTE_RESOLVER_PROXY).setModeAStakeEnabled(true);

        vm.stopBroadcast();

        console.log("\n=== P6 plan complete ===");
        console.log("MARKET_REGISTRY_IMPL=", address(newRegistryImpl));
        console.log("ECHO_HOOK_IMPL=", address(newHookImpl));
        console.log("DISPUTE_RESOLVER_IMPL=", address(newResolverImpl));
        console.log("\nLibrary addresses (EchoReveal / EchoBounty / EchoDirectJob) are in the");
        console.log("broadcast/ run log under CREATE transactions; copy them into constants.ts.");
        console.log("If this was a dry run (no --broadcast), nothing was sent.");
        console.log("Then: update IMPLEMENTATIONS + LIBRARIES in constants.ts, and seat the jury");
        console.log("(setJuror) + agent oracle (setAgentOracle) if not already done.");
    }
}
