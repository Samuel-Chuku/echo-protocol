// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MarketRegistry} from "../core/MarketRegistry.sol";
import {EchoHook} from "../core/EchoHook.sol";
import {AttributionRegistry} from "../core/AttributionRegistry.sol";
import {AttributionPayout} from "../core/AttributionPayout.sol";

/**
 * @title UpgradeEcho
 * @notice Brings a LIVE Echo deployment up to the attribution + fee model:
 *           - deploys the two NEW contracts (AttributionRegistry, AttributionPayout) as proxies
 *           - upgrades the two EXISTING proxies (MarketRegistry, EchoHook) in place via UUPS
 *             (same proxy address, same storage — only the implementation pointer changes)
 *           - wires the fee config and cross-links
 *
 * @dev DRY-RUN BY DEFAULT. forge only SENDS transactions when you pass --broadcast.
 *      Without --broadcast it simulates against forked state and sends nothing — that is
 *      your safety gate. The script always calls startBroadcast so the simulated and real
 *      runs take the identical path.
 *
 *      The upgrade calls are onlyOwner, so even the dry run must simulate AS the owner.
 *      Pass the owner via --sender (dry run) or use that owner's key (real run).
 *
 * STORAGE SAFETY (do this BEFORE broadcasting):
 *   The two upgrades are only safe because the new EchoHook/MarketRegistry variables were
 *   APPENDED to the end of storage, never inserted. Verify with:
 *     forge inspect EchoHook storageLayout
 *     forge inspect MarketRegistry storageLayout
 *   and compare against the deployed layout (or run OpenZeppelin's upgrade-safety check).
 *   If any existing slot moved, DO NOT upgrade.
 *
 * Usage (dry run — simulate against live testnet state, sends nothing):
 *   set -x ARC_TESTNET_RPC_URL "https://rpc.testnet.arc.network"
 *   forge script src/deployment/UpgradeEcho.s.sol:UpgradeEcho \
 *     --rpc-url $ARC_TESTNET_RPC_URL --sender <OWNER_ADDRESS>
 *   NOTE: --rpc-url is REQUIRED (the upgrades target live proxies on forked state) and
 *   --sender must be the proxies' owner (the upgrade calls are onlyOwner). No --broadcast
 *   means nothing is sent.
 *
 * Usage (real upgrade — only when ready; must use the OWNER wallet's key):
 *   set -x PRIVATE_KEY "0xOWNER_KEY"
 *   set -x PROTOCOL_TREASURY "0xYOUR_TREASURY"
 *   forge script src/deployment/UpgradeEcho.s.sol:UpgradeEcho \
 *     --rpc-url $ARC_TESTNET_RPC_URL --private-key $PRIVATE_KEY --broadcast
 */
contract UpgradeEcho is Script {
    // --- Live proxies (from .env / previous deploy) ---
    address constant MARKET_REGISTRY_PROXY = 0x6CE0899056cB7e36524703289Da66A8ED0e333dc;
    address constant ECHO_HOOK_PROXY = 0x6333b42426e5684BdB696BE2fF302AD5cfc84866;

    // --- Arc primitives ---
    address constant USDC = 0x3600000000000000000000000000000000000000;

    // --- Fee model defaults (override via env) ---
    uint16 constant DEFAULT_FEE_BPS = 500;       // 5% protocol take-rate
    uint16 constant DEFAULT_CEILING_BPS = 4000;  // attribution <= 40% of fee

    function run() external {
        uint16 feeBps = uint16(vm.envOr("PROTOCOL_FEE_BPS", uint256(DEFAULT_FEE_BPS)));
        uint16 ceilingBps = uint16(vm.envOr("ATTRIBUTION_CEILING_BPS", uint256(DEFAULT_CEILING_BPS)));
        address treasury = vm.envOr("PROTOCOL_TREASURY", address(0));

        console.log("=== Echo Upgrade: attribution + fee model ===");
        console.log("Fee bps:", feeBps);
        console.log("Ceiling bps:", ceilingBps);
        console.log("Treasury:", treasury);
        if (treasury == address(0)) {
            console.log("WARNING: treasury is zero. OK for a dry run; SET IT before --broadcast.");
        }

        vm.startBroadcast();

        // 1. New contract: AttributionRegistry (fresh proxy + impl).
        AttributionRegistry attributionImpl = new AttributionRegistry();
        ERC1967Proxy attributionProxy = new ERC1967Proxy(
            address(attributionImpl),
            abi.encodeWithSelector(AttributionRegistry.initialize.selector)
        );
        AttributionRegistry attribution = AttributionRegistry(address(attributionProxy));
        console.log("AttributionRegistry impl:", address(attributionImpl));
        console.log("AttributionRegistry proxy:", address(attributionProxy));

        // 2. New contract: AttributionPayout (fresh proxy + impl).
        AttributionPayout payoutImpl = new AttributionPayout();
        ERC1967Proxy payoutProxy = new ERC1967Proxy(
            address(payoutImpl),
            abi.encodeWithSelector(AttributionPayout.initialize.selector, address(attribution), ceilingBps)
        );
        AttributionPayout payout = AttributionPayout(address(payoutProxy));
        console.log("AttributionPayout impl:", address(payoutImpl));
        console.log("AttributionPayout proxy:", address(payoutProxy));

        // 3. Wire the new pair to each other and to the live proxies.
        attribution.setPayout(address(payout));
        attribution.setMarketRegistry(MARKET_REGISTRY_PROXY);
        payout.setEchoHook(ECHO_HOOK_PROXY);

        // 4. Upgrade EchoHook in place (new impl, same proxy + storage), then configure fee.
        EchoHook newEchoHookImpl = new EchoHook();
        EchoHook(ECHO_HOOK_PROXY).upgradeToAndCall(address(newEchoHookImpl), "");
        EchoHook(ECHO_HOOK_PROXY).setProtocolConfig(feeBps, treasury, address(payout), address(attribution));
        console.log("EchoHook NEW impl:", address(newEchoHookImpl));

        // 5. Upgrade MarketRegistry in place, then link the attribution registry.
        MarketRegistry newRegistryImpl = new MarketRegistry();
        MarketRegistry(MARKET_REGISTRY_PROXY).upgradeToAndCall(address(newRegistryImpl), "");
        MarketRegistry(MARKET_REGISTRY_PROXY).setAttributionRegistry(address(attribution));
        console.log("MarketRegistry NEW impl:", address(newRegistryImpl));

        vm.stopBroadcast();

        console.log("\n=== Upgrade plan complete ===");
        console.log("ATTRIBUTION_REGISTRY_PROXY=", address(attributionProxy));
        console.log("ATTRIBUTION_PAYOUT_PROXY=", address(payoutProxy));
        console.log("ECHO_HOOK_IMPL=", address(newEchoHookImpl));
        console.log("MARKET_REGISTRY_IMPL=", address(newRegistryImpl));
        console.log("\nIf this was a dry run (no --broadcast), nothing was sent.");
        console.log("Before --broadcast: run the storageLayout checks in the script header,");
        console.log("set PROTOCOL_TREASURY, and use the owner wallet's key.");
        console.log("After a real run: add the two new proxy addresses to .env.");
    }
}
