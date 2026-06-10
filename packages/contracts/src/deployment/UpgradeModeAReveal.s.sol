// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {MarketRegistry} from "../core/MarketRegistry.sol";
import {EchoHook} from "../core/EchoHook.sol";

/**
 * @title UpgradeModeAReveal
 * @notice P2 (Mode A disclosure + reveal) in-place UUPS upgrade. Swaps MarketRegistry + EchoHook
 *         to the reveal-aware impls:
 *           - MarketRegistry.reveal(marketId, participant): atomic entry payment — refunds the
 *             applicant stake and pays the reveal fee R (net of protocol fee, AR overlay earning)
 *             in one tx; advances to tier 1; counts toward the floor. Plus the min-reveal escrow
 *             binding at create and the closeMarket reveal-floor guard.
 *           - EchoHook.settleReveal(...): synchronous settlement leg (no ERC-8183 job), sharing
 *             the exact fee/attribution/pool/reputation path as a tier completion.
 *
 *         ADDITIVE only. MarketRegistry appends revealFee (slot 15) + revealCount (slot 16) after
 *         the P1 vars; EchoHook adds NO new storage (settleReveal reuses existing mappings).
 *         No new sibling contract, no re-wiring, no re-init.
 *
 * @dev DRY-RUN BY DEFAULT (forge sends only with --broadcast). Upgrade calls are onlyOwner —
 *      simulate AS the owner (--sender) and broadcast with the owner keystore.
 *
 * STORAGE SAFETY (verify before broadcasting):
 *   forge clean
 *   forge inspect src/core/MarketRegistry.sol:MarketRegistry storageLayout
 *   forge inspect src/core/EchoHook.sol:EchoHook storageLayout
 *   MarketRegistry slots 0–14 MUST be identical to the deployed P1 layout, with revealFee (slot 15)
 *   and revealCount (slot 16) appended. EchoHook slots 0–14 MUST be unchanged (no additions). If
 *   any existing slot moved, DO NOT upgrade.
 *
 * Usage (dry run):
 *   set -x ARC_TESTNET_RPC_URL "https://rpc.testnet.arc.network"
 *   forge script src/deployment/UpgradeModeAReveal.s.sol:UpgradeModeAReveal \
 *     --rpc-url $ARC_TESTNET_RPC_URL --sender <OWNER_ADDRESS>
 *
 * Usage (real upgrade — owner keystore, per circle:use-arc no-plaintext-keys rule):
 *   cast wallet import echo-deployer --interactive
 *   forge script src/deployment/UpgradeModeAReveal.s.sol:UpgradeModeAReveal \
 *     --rpc-url $ARC_TESTNET_RPC_URL --account echo-deployer --broadcast
 *
 * AFTER a real run: record the two new impls in packages/sdk/src/constants.ts.
 */
contract UpgradeModeAReveal is Script {
    // --- Live proxies (canonical) ---
    address constant MARKET_REGISTRY_PROXY = 0x6CE0899056cB7e36524703289Da66A8ED0e333dc;
    address constant ECHO_HOOK_PROXY = 0x6333b42426e5684BdB696BE2fF302AD5cfc84866;

    function run() external {
        console.log("=== Echo P2: Mode A disclosure + reveal ===");

        vm.startBroadcast();

        // EchoHook first (adds settleReveal; no storage change). No re-init.
        EchoHook newEchoHookImpl = new EchoHook();
        EchoHook(ECHO_HOOK_PROXY).upgradeToAndCall(address(newEchoHookImpl), "");
        console.log("EchoHook NEW impl:   ", address(newEchoHookImpl));

        // MarketRegistry (reveal path + bindings; appends revealFee/revealCount). No re-init.
        MarketRegistry newRegistryImpl = new MarketRegistry();
        MarketRegistry(MARKET_REGISTRY_PROXY).upgradeToAndCall(address(newRegistryImpl), "");
        console.log("MarketRegistry NEW impl:", address(newRegistryImpl));

        vm.stopBroadcast();

        console.log("\n=== P2 plan complete ===");
        console.log("ECHO_HOOK_IMPL=", address(newEchoHookImpl));
        console.log("MARKET_REGISTRY_IMPL=", address(newRegistryImpl));
        console.log("\nIf this was a dry run (no --broadcast), nothing was sent.");
        console.log("After a real run: update IMPLEMENTATIONS in constants.ts with the new impls.");
    }
}
