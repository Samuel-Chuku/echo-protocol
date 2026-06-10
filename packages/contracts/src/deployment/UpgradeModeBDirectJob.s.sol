// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {MarketRegistry} from "../core/MarketRegistry.sol";
import {EchoHook} from "../core/EchoHook.sol";

/**
 * @title UpgradeModeBDirectJob
 * @notice P3 (Mode B — Direct Job + milestones) in-place UUPS upgrade of EchoHook + MarketRegistry.
 *         Additive: EchoHook gains settleMilestone + a Tier.Milestone enum value (no new storage);
 *         MarketRegistry gains the direct-job lifecycle (createDirectJob / submit / accept /
 *         autoRelease / cancel) and appends directJobs (slot 17) + directJobMilestones (slot 18).
 *         No new sibling, no re-wire, no re-init.
 *
 * @dev DRY-RUN BY DEFAULT. forge sends only with --broadcast. Upgrade calls are onlyOwner —
 *      simulate as the owner (--sender) and broadcast with the owner keystore.
 *
 * STORAGE SAFETY (verify before broadcasting):
 *   forge clean
 *   forge inspect src/core/MarketRegistry.sol:MarketRegistry storageLayout  # 0-16 unchanged; directJobs slot 17, directJobMilestones slot 18
 *   forge inspect src/core/EchoHook.sol:EchoHook storageLayout              # 0-14 unchanged (P3 adds no EchoHook storage)
 *   If any existing slot moved, DO NOT upgrade.
 *
 * Usage (dry run):
 *   set -x ARC_TESTNET_RPC_URL "https://rpc.testnet.arc.network"
 *   forge script src/deployment/UpgradeModeBDirectJob.s.sol:UpgradeModeBDirectJob \
 *     --rpc-url $ARC_TESTNET_RPC_URL --sender <OWNER_ADDRESS>
 *
 * Usage (real upgrade — owner keystore):
 *   cast wallet import echo-deployer --interactive
 *   forge script src/deployment/UpgradeModeBDirectJob.s.sol:UpgradeModeBDirectJob \
 *     --rpc-url $ARC_TESTNET_RPC_URL --account echo-deployer --broadcast
 *
 * AFTER a real run: record the two new impls in packages/sdk/src/constants.ts.
 */
contract UpgradeModeBDirectJob is Script {
    // --- Live proxies (canonical) ---
    address constant MARKET_REGISTRY_PROXY = 0x6CE0899056cB7e36524703289Da66A8ED0e333dc;
    address constant ECHO_HOOK_PROXY = 0x6333b42426e5684BdB696BE2fF302AD5cfc84866;

    function run() external {
        console.log("=== Echo P3: Mode B direct job + milestones ===");

        vm.startBroadcast();

        // EchoHook first (adds settleMilestone; no storage change). MarketRegistry.createDirectJob
        // settles via the hook, so the hook must carry the new method before the registry goes live.
        EchoHook newEchoHookImpl = new EchoHook();
        EchoHook(ECHO_HOOK_PROXY).upgradeToAndCall(address(newEchoHookImpl), "");
        console.log("EchoHook NEW impl:   ", address(newEchoHookImpl));

        // MarketRegistry (direct-job lifecycle; appends directJobs/directJobMilestones). No re-init.
        MarketRegistry newRegistryImpl = new MarketRegistry();
        MarketRegistry(MARKET_REGISTRY_PROXY).upgradeToAndCall(address(newRegistryImpl), "");
        console.log("MarketRegistry NEW impl:", address(newRegistryImpl));

        vm.stopBroadcast();

        console.log("\n=== P3 plan complete ===");
        console.log("ECHO_HOOK_IMPL=", address(newEchoHookImpl));
        console.log("MARKET_REGISTRY_IMPL=", address(newRegistryImpl));
        console.log("\nIf this was a dry run (no --broadcast), nothing was sent.");
        console.log("After a real run: update IMPLEMENTATIONS in constants.ts with the new impls.");
    }
}
