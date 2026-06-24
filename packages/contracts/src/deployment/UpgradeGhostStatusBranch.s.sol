// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {EchoHook} from "../core/EchoHook.sol";

/**
 * @title UpgradeGhostStatusBranch
 * @notice Single-impl UUPS upgrade on the live EchoHook proxy. This upgrade changes the
 *         behaviour of `triggerGhost` so the penalty path is decided by the actual Arc job
 *         status at the deadline:
 *
 *           - Arc job Submitted  → existing requester-ghost path: pay worker the ghost reserve,
 *                                  slash requester R-Rep (-1 "ghosted"), credit worker (+1
 *                                  "ghosted_victim"). GhostPenalty + RRepSlashed events.
 *           - Arc job Open       → NEW worker-ghost path: no USDC moves (ghost reserve stays
 *                                  in escrow and refunds on closeMarket), worker P-Rep slashed
 *                                  (-1 "worker_ghosted"), requester untouched. Emits NEW
 *                                  WorkerGhosted event instead of GhostPenalty.
 *           - Anything else      → no-op (terminal states / unreachable today).
 *
 *         No storage layout change (only the function body + a new event declaration; events
 *         live in metadata, not storage). Other contracts (MarketRegistry, DisputeResolver,
 *         ParticipationReceipt, AttributionRegistry, AttributionPayout) are untouched.
 *
 * @dev DRY-RUN BY DEFAULT — forge sends only with --broadcast. upgradeToAndCall is onlyOwner;
 *      simulate as the owner (--sender) and broadcast with the owner keystore.
 *
 * STORAGE SAFETY (verify before broadcasting):
 *   forge clean
 *   forge inspect src/core/EchoHook.sol:EchoHook storageLayout
 *     # All existing slots must be identical to the prior P6 layout. If any moved, DO NOT upgrade.
 *
 * Usage (dry run):
 *   set -x ARC_TESTNET_RPC_URL "https://rpc.testnet.arc.network"
 *   forge script src/deployment/UpgradeGhostStatusBranch.s.sol:UpgradeGhostStatusBranch \
 *     --rpc-url $ARC_TESTNET_RPC_URL --sender <OWNER_ADDRESS>
 *
 * Usage (real upgrade — owner keystore):
 *   forge script src/deployment/UpgradeGhostStatusBranch.s.sol:UpgradeGhostStatusBranch \
 *     --rpc-url $ARC_TESTNET_RPC_URL --account echo-deployer --broadcast
 *
 * AFTER a real run: record the new EchoHook impl address in packages/sdk/src/constants.ts
 * IMPLEMENTATIONS.arcTestnet.echoHook so future tooling can verify against it.
 */
contract UpgradeGhostStatusBranch is Script {
    // Live EchoHook proxy on Arc Testnet (unchanged across all prior upgrades).
    address constant ECHO_HOOK_PROXY = 0x6333b42426e5684BdB696BE2fF302AD5cfc84866;

    function run() external {
        console.log("=== EchoHook upgrade: triggerGhost status-branch (worker vs requester ghost) ===");

        vm.startBroadcast();

        EchoHook newHookImpl = new EchoHook();
        EchoHook(ECHO_HOOK_PROXY).upgradeToAndCall(address(newHookImpl), "");

        vm.stopBroadcast();

        console.log("EchoHook NEW impl: ", address(newHookImpl));
        console.log("\nNext: update IMPLEMENTATIONS.arcTestnet.echoHook in packages/sdk/src/constants.ts.");
        console.log("If this was a dry run (no --broadcast), nothing was sent.");
    }
}
