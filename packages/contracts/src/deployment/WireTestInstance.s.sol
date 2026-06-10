// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {EchoHook} from "../core/EchoHook.sol";
import {MarketRegistry} from "../core/MarketRegistry.sol";

/**
 * @title WireTestInstance
 * @notice Points the live EchoHook + MarketRegistry proxies at a given AgenticCommerce
 *         instance (the one deployed by DeployArcTestInstance.s.sol). Both must agree on the
 *         instance: MarketRegistry creates jobs on it, and EchoHook only accepts hook
 *         callbacks from it (onlyAgenticCommerce). Owner-gated calls.
 *
 *         Run AFTER:
 *           1. UpgradeArcReintegration (so the proxies have the setAgenticCommerce setters), and
 *           2. DeployArcTestInstance (so AGENTIC_COMMERCE exists and EchoHook is whitelisted on it).
 *
 *         To switch BACK to Arc's canonical AgenticCommerce later (Path A, once Circle
 *         whitelists EchoHook), re-run this with AGENTIC_COMMERCE=0x0747EEf0…4583.
 *
 * @dev DRY-RUN BY DEFAULT. Owner-only — broadcast with the owner keystore:
 *        set -x AGENTIC_COMMERCE 0xYourTestInstanceProxy
 *        forge script src/deployment/WireTestInstance.s.sol:WireTestInstance \
 *          --rpc-url $ARC_TESTNET_RPC_URL --account echo-deployer --broadcast
 */
contract WireTestInstance is Script {
    address constant MARKET_REGISTRY_PROXY = 0x6CE0899056cB7e36524703289Da66A8ED0e333dc;
    address constant ECHO_HOOK_PROXY = 0x6333b42426e5684BdB696BE2fF302AD5cfc84866;

    function run() external {
        address ac = vm.envAddress("AGENTIC_COMMERCE");
        require(ac != address(0), "set AGENTIC_COMMERCE to the instance proxy");

        console.log("=== Wire Echo -> AgenticCommerce ===");
        console.log("AgenticCommerce:", ac);

        vm.startBroadcast();
        EchoHook(ECHO_HOOK_PROXY).setAgenticCommerce(ac);
        MarketRegistry(MARKET_REGISTRY_PROXY).setAgenticCommerce(ac);
        vm.stopBroadcast();

        console.log("EchoHook.agenticCommerce      ->", address(EchoHook(ECHO_HOOK_PROXY).agenticCommerce()));
        console.log("MarketRegistry.agenticCommerce->", address(MarketRegistry(MARKET_REGISTRY_PROXY).agenticCommerce()));
        console.log("\nNext: set CONTRACTS.arcTestnet.agenticCommerce =", ac);
        console.log("in packages/sdk/src/constants.ts, then run the e2e.");
    }
}
