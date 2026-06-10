// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {MarketRegistry} from "../core/MarketRegistry.sol";
import {EchoHook} from "../core/EchoHook.sol";

/**
 * @title UpgradeArcReintegration
 * @notice In-place UUPS upgrade that swaps EchoHook + MarketRegistry to the real-Arc
 *         implementations (ERC-8004 ERC-721 identity, giveFeedback reputation, IACPHook
 *         before/afterAction lifecycle). Nothing else changes.
 *
 *         This is NOT the attribution upgrade (see UpgradeEcho.s.sol) — the attribution
 *         registry/payout proxies are already live and already wired, so this script does
 *         NOT redeploy or re-wire them. It only deploys two new impls and points the two
 *         existing proxies at them. No re-initialization: storage is preserved and no new
 *         state variables were added (only struct fields inside existing mappings).
 *
 * @dev DRY-RUN BY DEFAULT. forge sends transactions only with --broadcast. The upgrade
 *      calls are onlyOwner, so simulate AS the owner (--sender) and broadcast with the
 *      owner key.
 *
 * STORAGE SAFETY (already verified, re-check before broadcasting):
 *   forge inspect src/core/EchoHook.sol:EchoHook storageLayout
 *   forge inspect src/core/MarketRegistry.sol:MarketRegistry storageLayout
 *   Contract-level slots must be unchanged vs the deployed layout. They are: EchoHook
 *   slots 0–13 and MarketRegistry slots 0–10 are identical; the new agentId/requesterAgentId
 *   fields live inside the markets/marketApplications mappings, and marketCount == 0 so
 *   there is zero existing data to migrate. If any contract-level slot moved, DO NOT upgrade.
 *
 * Usage (dry run — simulate against live testnet, sends nothing):
 *   set -x ARC_TESTNET_RPC_URL "https://rpc.testnet.arc.network"
 *   forge script src/deployment/UpgradeArcReintegration.s.sol:UpgradeArcReintegration \
 *     --rpc-url $ARC_TESTNET_RPC_URL --sender <OWNER_ADDRESS>
 *
 * Usage (real upgrade — owner key only):
 *   set -x PRIVATE_KEY "0xOWNER_KEY"
 *   forge script src/deployment/UpgradeArcReintegration.s.sol:UpgradeArcReintegration \
 *     --rpc-url $ARC_TESTNET_RPC_URL --private-key $PRIVATE_KEY --broadcast
 *
 * AFTER a successful upgrade, Arc must whitelist the hook before any createJob succeeds:
 *   agenticCommerce.setHookWhitelist(ECHO_HOOK_PROXY, true)   // Arc admin's action, not ours
 */
contract UpgradeArcReintegration is Script {
    // --- Live proxies (canonical, from constants.ts / prior deploy) ---
    address constant MARKET_REGISTRY_PROXY = 0x6CE0899056cB7e36524703289Da66A8ED0e333dc;
    address constant ECHO_HOOK_PROXY = 0x6333b42426e5684BdB696BE2fF302AD5cfc84866;

    // --- Arc primitive expected to back EchoHook's reputation writes ---
    address constant REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    function run() external {
        console.log("=== Echo: real-Arc re-integration upgrade ===");

        // Sanity: confirm EchoHook already points at the real reputation registry, so the
        // new giveFeedback path targets live Arc (reputation is best-effort, but verify anyway).
        address repNow = address(EchoHook(ECHO_HOOK_PROXY).reputationRegistry());
        console.log("EchoHook.reputationRegistry (live):", repNow);
        if (repNow != REPUTATION_REGISTRY) {
            console.log("WARNING: reputationRegistry != live Arc registry; giveFeedback will target", repNow);
        }

        vm.startBroadcast();

        // 1. Upgrade EchoHook in place (new IACPHook impl, same proxy + storage). No re-init.
        EchoHook newEchoHookImpl = new EchoHook();
        EchoHook(ECHO_HOOK_PROXY).upgradeToAndCall(address(newEchoHookImpl), "");
        console.log("EchoHook NEW impl:", address(newEchoHookImpl));

        // 2. Upgrade MarketRegistry in place (identity-threaded createMarket/applyToMarket).
        MarketRegistry newRegistryImpl = new MarketRegistry();
        MarketRegistry(MARKET_REGISTRY_PROXY).upgradeToAndCall(address(newRegistryImpl), "");
        console.log("MarketRegistry NEW impl:", address(newRegistryImpl));

        vm.stopBroadcast();

        console.log("\n=== Upgrade plan complete ===");
        console.log("ECHO_HOOK_IMPL=", address(newEchoHookImpl));
        console.log("MARKET_REGISTRY_IMPL=", address(newRegistryImpl));
        console.log("\nIf this was a dry run (no --broadcast), nothing was sent.");
        console.log("NEXT: Arc must call agenticCommerce.setHookWhitelist(ECHO_HOOK_PROXY, true)");
        console.log("      before grading can spawn jobs. Then run the SDK e2e.");
        console.log("After a real run: update IMPLEMENTATIONS in constants.ts with the new impls.");
    }
}
