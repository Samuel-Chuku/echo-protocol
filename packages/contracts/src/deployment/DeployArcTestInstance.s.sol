// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AgenticCommerce} from "../arc/AgenticCommerce.sol";

/**
 * @title DeployArcTestInstance
 * @notice Deploys Echo's OWN AgenticCommerce instance on Arc testnet (Path C) so EchoHook
 *         can be self-whitelisted without Circle. This is a self-hosted copy of the EIP-8183
 *         reference contract — see src/arc/AgenticCommerce.sol. The broadcasting wallet
 *         becomes ADMIN_ROLE + DEFAULT_ADMIN_ROLE.
 *
 *         Steps performed:
 *           1. deploy AgenticCommerce impl + ERC1967 proxy, initialize(USDC, treasury, admin)
 *           2. whitelist the live EchoHook proxy so createJob(...,echoHook) is permitted
 *           3. (fees left at 0 — Echo settles its own tiered payouts from EchoHook escrow)
 *
 *         After this, run WireTestInstance.s.sol to point EchoHook + MarketRegistry at the
 *         new instance, then update packages/sdk/src/constants.ts.
 *
 * @dev DRY-RUN BY DEFAULT (no --broadcast = nothing sent). Use an encrypted keystore, never
 *      a plaintext --private-key, even on testnet (per Circle's Arc guidance):
 *        cast wallet import echo-deployer --interactive
 *        forge script src/deployment/DeployArcTestInstance.s.sol:DeployArcTestInstance \
 *          --rpc-url $ARC_TESTNET_RPC_URL --account echo-deployer --broadcast
 *      Fund the deployer at https://faucet.circle.com first.
 *
 * Env:
 *   PROTOCOL_TREASURY  (optional) treasury for the instance; defaults to the broadcaster.
 *   ECHO_HOOK          (optional) EchoHook proxy to whitelist; defaults to the live address.
 */
contract DeployArcTestInstance is Script {
    // Arc testnet native USDC (6-decimal ERC-20).
    address constant USDC = 0x3600000000000000000000000000000000000000;
    // Live EchoHook proxy (from constants.ts) — the hook we self-whitelist.
    address constant ECHO_HOOK_DEFAULT = 0x6333b42426e5684BdB696BE2fF302AD5cfc84866;

    function run() external {
        address admin = msg.sender; // the broadcasting wallet becomes admin
        address treasury = vm.envOr("PROTOCOL_TREASURY", admin);
        address echoHook = vm.envOr("ECHO_HOOK", ECHO_HOOK_DEFAULT);

        console.log("=== Deploy Echo-owned AgenticCommerce (Path C) ===");
        console.log("admin (broadcaster):", admin);
        console.log("treasury:", treasury);
        console.log("echoHook to whitelist:", echoHook);

        vm.startBroadcast();

        AgenticCommerce impl = new AgenticCommerce();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(AgenticCommerce.initialize.selector, USDC, treasury, admin)
        );
        AgenticCommerce ac = AgenticCommerce(address(proxy));
        console.log("AgenticCommerce impl: ", address(impl));
        console.log("AgenticCommerce proxy:", address(proxy));

        // Self-whitelist EchoHook (the whole point of Path C).
        ac.setHookWhitelist(echoHook, true);
        console.log("EchoHook whitelisted: ", ac.whitelistedHooks(echoHook));

        vm.stopBroadcast();

        console.log("\n=== Done ===");
        console.log("AGENTIC_COMMERCE_TEST_INSTANCE=", address(proxy));
        console.log("Next: WireTestInstance.s.sol (point EchoHook + MarketRegistry here),");
        console.log("      then set CONTRACTS.arcTestnet.agenticCommerce in the SDK.");
        console.log("If this was a dry run (no --broadcast), nothing was sent.");
    }
}
