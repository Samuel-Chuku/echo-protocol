// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MarketRegistry} from "../core/MarketRegistry.sol";
import {EchoHook} from "../core/EchoHook.sol";
import {ParticipationReceipt} from "../core/ParticipationReceipt.sol";

/**
 * @title DeployEcho
 * @notice Deploys Echo Protocol with UUPS upgradeable proxies.
 * @dev Deployment order (2-step to resolve circular deps):
 *   1. Deploy implementations
 *   2. Deploy EchoHook proxy + initialize
 *   3. Deploy ParticipationReceipt proxy + initialize
 *   4. Deploy MarketRegistry proxy + initialize (echoHook=0, receipt=0)
 *   5. Link: EchoHook.setMarketRegistry(registry)
 *   6. Link: Receipt.setMarketRegistry(registry)
 *   7. Link: MarketRegistry.setEchoHook(echoHook)
 *   8. Link: MarketRegistry.setParticipationReceipt(receipt)
 *
 * Usage:
 *   set -x PRIVATE_KEY "0xYOUR_KEY"
 *   set -x ARC_TESTNET_RPC_URL "https://rpc.testnet.arc.network"
 *   forge script src/deployment/DeployEcho.s.sol:DeployEcho --rpc-url $ARC_TESTNET_RPC_URL --private-key $PRIVATE_KEY --broadcast
 */
contract DeployEcho is Script {
    // Arc Testnet verified contract addresses
    address constant AGENTIC_COMMERCE = 0x0747EEf0706327138c69792bF28Cd525089e4583;
    address constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address constant REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;
    address constant VALIDATION_REGISTRY = 0x8004Cb1BF31DAf7788923b405b754f57acEB4272;
    address constant USDC = 0x3600000000000000000000000000000000000000; // VERIFY THIS

    function run() external {
        vm.startBroadcast();

        // Step 1: Deploy implementations
        MarketRegistry marketRegistryImpl = new MarketRegistry();
        EchoHook echoHookImpl = new EchoHook();
        ParticipationReceipt receiptImpl = new ParticipationReceipt();

        console.log("MarketRegistry impl:", address(marketRegistryImpl));
        console.log("EchoHook impl:", address(echoHookImpl));
        console.log("ParticipationReceipt impl:", address(receiptImpl));

        // Step 2: Deploy EchoHook proxy + init
        ERC1967Proxy echoHookProxy = new ERC1967Proxy(
            address(echoHookImpl),
            abi.encodeWithSelector(
                EchoHook.initialize.selector,
                AGENTIC_COMMERCE,
                REPUTATION_REGISTRY,
                USDC
            )
        );
        EchoHook echoHook = EchoHook(address(echoHookProxy));
        console.log("EchoHook proxy:", address(echoHookProxy));

        // Step 3: Deploy ParticipationReceipt proxy + init
        ERC1967Proxy receiptProxy = new ERC1967Proxy(
            address(receiptImpl),
            abi.encodeWithSelector(ParticipationReceipt.initialize.selector)
        );
        ParticipationReceipt receipt = ParticipationReceipt(address(receiptProxy));
        console.log("ParticipationReceipt proxy:", address(receiptProxy));

        // Step 4: Deploy MarketRegistry proxy + init (placeholders for circular deps)
        ERC1967Proxy marketRegistryProxy = new ERC1967Proxy(
            address(marketRegistryImpl),
            abi.encodeWithSelector(
                MarketRegistry.initialize.selector,
                USDC,
                AGENTIC_COMMERCE,
                IDENTITY_REGISTRY,
                address(0), // echoHook placeholder
                address(0)  // participationReceipt placeholder
            )
        );
        MarketRegistry marketRegistry = MarketRegistry(address(marketRegistryProxy));
        console.log("MarketRegistry proxy:", address(marketRegistryProxy));

        // Step 5-6: Link EchoHook and Receipt to MarketRegistry
        echoHook.setMarketRegistry(address(marketRegistry));
        receipt.setMarketRegistry(address(marketRegistry));

        // Step 7-8: Link MarketRegistry to EchoHook and Receipt
        marketRegistry.setEchoHook(address(echoHook));
        marketRegistry.setParticipationReceipt(address(receipt));

        vm.stopBroadcast();

        console.log("\n=== Deployment Complete ===");
        console.log("MARKET_REGISTRY_PROXY=", address(marketRegistryProxy));
        console.log("ECHO_HOOK_PROXY=", address(echoHookProxy));
        console.log("PARTICIPATION_RECEIPT_PROXY=", address(receiptProxy));
        console.log("\n=== Implementation Addresses (for upgrades) ===");
        console.log("MARKET_REGISTRY_IMPL=", address(marketRegistryImpl));
        console.log("ECHO_HOOK_IMPL=", address(echoHookImpl));
        console.log("PARTICIPATION_RECEIPT_IMPL=", address(receiptImpl));
        console.log("\n=== Next Steps ===");
        console.log("1. Verify contracts on Arcscan");
        console.log("2. Update .env with proxy addresses");
        console.log("3. Run integration tests against testnet");
    }
}
