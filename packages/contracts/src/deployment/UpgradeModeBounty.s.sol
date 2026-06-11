// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {MarketRegistry} from "../core/MarketRegistry.sol";
import {EchoHook} from "../core/EchoHook.sol";

/**
 * @title UpgradeModeBounty
 * @notice P4 (Mode Bounty — open submissions, parallel winners) in-place UUPS upgrade of
 *         EchoHook + MarketRegistry. Additive: EchoHook gains settleFinding + a Tier.Finding enum
 *         value (no new storage); MarketRegistry gains the bounty lifecycle (createBounty /
 *         submitFinding / acceptFinding / rejectFinding / autoEscalateFinding / closeBounty) and
 *         appends bounties (slot 19) + bountyFindings (slot 20) + bountyPendingCount (slot 21).
 *         No new sibling, no re-wire, no re-init.
 *
 * @dev DRY-RUN BY DEFAULT. forge sends only with --broadcast. Upgrade calls are onlyOwner —
 *      simulate as the owner (--sender) and broadcast with the owner keystore.
 *
 * STORAGE SAFETY (verify before broadcasting):
 *   forge clean
 *   forge inspect src/core/MarketRegistry.sol:MarketRegistry storageLayout  # 0-18 unchanged; bounties slot 19, bountyFindings slot 20, bountyPendingCount slot 21
 *   forge inspect src/core/EchoHook.sol:EchoHook storageLayout              # 0-14 unchanged (P4 adds no EchoHook storage)
 *   If any existing slot moved, DO NOT upgrade.
 *
 * Usage (dry run):
 *   set -x ARC_TESTNET_RPC_URL "https://rpc.testnet.arc.network"
 *   forge script src/deployment/UpgradeModeBounty.s.sol:UpgradeModeBounty \
 *     --rpc-url $ARC_TESTNET_RPC_URL --sender <OWNER_ADDRESS>
 *
 * Usage (real upgrade — owner keystore):
 *   cast wallet import echo-deployer --interactive
 *   forge script src/deployment/UpgradeModeBounty.s.sol:UpgradeModeBounty \
 *     --rpc-url $ARC_TESTNET_RPC_URL --account echo-deployer --broadcast
 *
 * AFTER a real run: record the two new impls in packages/sdk/src/constants.ts.
 */
contract UpgradeModeBounty is Script {
    // --- Live proxies (canonical) ---
    address constant MARKET_REGISTRY_PROXY = 0x6CE0899056cB7e36524703289Da66A8ED0e333dc;
    address constant ECHO_HOOK_PROXY = 0x6333b42426e5684BdB696BE2fF302AD5cfc84866;

    function run() external {
        console.log("=== Echo P4: Mode Bounty - open submissions, parallel winners ===");

        vm.startBroadcast();

        // EchoHook first (adds settleFinding; no storage change). MarketRegistry.acceptFinding
        // settles via the hook, so the hook must carry the new method before the registry goes live.
        EchoHook newEchoHookImpl = new EchoHook();
        EchoHook(ECHO_HOOK_PROXY).upgradeToAndCall(address(newEchoHookImpl), "");
        console.log("EchoHook NEW impl:   ", address(newEchoHookImpl));

        // MarketRegistry (bounty lifecycle; appends bounties/bountyFindings/bountyPendingCount). No re-init.
        MarketRegistry newRegistryImpl = new MarketRegistry();
        MarketRegistry(MARKET_REGISTRY_PROXY).upgradeToAndCall(address(newRegistryImpl), "");
        console.log("MarketRegistry NEW impl:", address(newRegistryImpl));

        vm.stopBroadcast();

        console.log("\n=== P4 plan complete ===");
        console.log("ECHO_HOOK_IMPL=", address(newEchoHookImpl));
        console.log("MARKET_REGISTRY_IMPL=", address(newRegistryImpl));
        console.log("\nIf this was a dry run (no --broadcast), nothing was sent.");
        console.log("After a real run: update IMPLEMENTATIONS in constants.ts with the new impls.");
    }
}
