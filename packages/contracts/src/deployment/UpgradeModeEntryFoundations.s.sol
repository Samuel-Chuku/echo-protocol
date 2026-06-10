// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MarketRegistry} from "../core/MarketRegistry.sol";
import {EchoHook} from "../core/EchoHook.sol";
import {ValidationGate} from "../core/ValidationGate.sol";

/**
 * @title UpgradeModeEntryFoundations
 * @notice P1 (mode + entry foundations) deploy/upgrade. Three steps:
 *           1. Deploy the ValidationGate sibling (impl + ERC1967 proxy, initialize(identity)).
 *           2. Upgrade MarketRegistry + EchoHook in place to the mode/stake-aware impls.
 *           3. Wire MarketRegistry → ValidationGate (one-time setter, AlreadySet-guarded).
 *
 *         All changes are ADDITIVE: new mappings + appended state vars only, never struct
 *         field-inserts; marketCount == 0 ⇒ zero data migration. Legacy createMarket /
 *         applyToMarket keep working (Open Market, identity-only, no stake) — once the gate is
 *         wired it becomes authoritative for entry.
 *
 * @dev DRY-RUN BY DEFAULT. forge sends transactions only with --broadcast. The upgrade +
 *      setValidationGate calls are onlyOwner, so simulate AS the owner (--sender) and broadcast
 *      with the owner key/keystore.
 *
 * STORAGE SAFETY (verify before broadcasting):
 *   forge clean
 *   forge inspect src/core/EchoHook.sol:EchoHook storageLayout
 *   forge inspect src/core/MarketRegistry.sol:MarketRegistry storageLayout
 *   Contract-level slots must be unchanged vs the deployed layout: EchoHook 0–13 identical with
 *   `stakeBalance` appended at slot 14; MarketRegistry 0–10 identical (through attributionRegistry
 *   at slot 10) with validationGate (11) / marketMode (12) / marketRequiredProofs (13) /
 *   marketStakeRequired (14) appended.
 *   If any existing slot moved, DO NOT upgrade.
 *
 * Usage (dry run — simulate against live testnet, sends nothing):
 *   set -x ARC_TESTNET_RPC_URL "https://rpc.testnet.arc.network"
 *   forge script src/deployment/UpgradeModeEntryFoundations.s.sol:UpgradeModeEntryFoundations \
 *     --rpc-url $ARC_TESTNET_RPC_URL --sender <OWNER_ADDRESS>
 *
 * Usage (real upgrade — owner keystore, per circle:use-arc no-plaintext-keys rule):
 *   cast wallet import echo-deployer --interactive
 *   forge script src/deployment/UpgradeModeEntryFoundations.s.sol:UpgradeModeEntryFoundations \
 *     --rpc-url $ARC_TESTNET_RPC_URL --account echo-deployer --broadcast
 *
 * AFTER a real run: record VALIDATION_GATE + the two new impls in packages/sdk/src/constants.ts.
 */
contract UpgradeModeEntryFoundations is Script {
    // --- Live proxies (canonical, from constants.ts / prior deploys) ---
    address constant MARKET_REGISTRY_PROXY = 0x6CE0899056cB7e36524703289Da66A8ED0e333dc;
    address constant ECHO_HOOK_PROXY = 0x6333b42426e5684BdB696BE2fF302AD5cfc84866;

    // --- Arc ERC-8004 IdentityRegistry the gate checks identity-ownership against (live) ---
    address constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    function run() external {
        console.log("=== Echo P1: mode + entry foundations ===");

        vm.startBroadcast();

        // 1. Deploy the ValidationGate sibling (impl + proxy), initialized to the live identity registry.
        ValidationGate gateImpl = new ValidationGate();
        ERC1967Proxy gateProxy = new ERC1967Proxy(
            address(gateImpl),
            abi.encodeWithSelector(ValidationGate.initialize.selector, IDENTITY_REGISTRY)
        );
        console.log("ValidationGate impl: ", address(gateImpl));
        console.log("ValidationGate proxy:", address(gateProxy));

        // 2. Upgrade EchoHook in place (adds stake escrow/refund/slash). No re-init.
        EchoHook newEchoHookImpl = new EchoHook();
        EchoHook(ECHO_HOOK_PROXY).upgradeToAndCall(address(newEchoHookImpl), "");
        console.log("EchoHook NEW impl:   ", address(newEchoHookImpl));

        // 3. Upgrade MarketRegistry in place (mode + gate + stake-aware apply/create). No re-init.
        MarketRegistry newRegistryImpl = new MarketRegistry();
        MarketRegistry(MARKET_REGISTRY_PROXY).upgradeToAndCall(address(newRegistryImpl), "");
        console.log("MarketRegistry NEW impl:", address(newRegistryImpl));

        // 4. Wire the gate (one-time, AlreadySet-guarded). Until wired, entry falls back to the
        //    inline identity check, so this is the switch that turns the genesis filter on.
        MarketRegistry(MARKET_REGISTRY_PROXY).setValidationGate(address(gateProxy));
        console.log("MarketRegistry.validationGate wired.");

        vm.stopBroadcast();

        console.log("\n=== P1 plan complete ===");
        console.log("VALIDATION_GATE=", address(gateProxy));
        console.log("ECHO_HOOK_IMPL=", address(newEchoHookImpl));
        console.log("MARKET_REGISTRY_IMPL=", address(newRegistryImpl));
        console.log("\nIf this was a dry run (no --broadcast), nothing was sent.");
        console.log("After a real run: update constants.ts (VALIDATION_GATE + new impls).");
    }
}
