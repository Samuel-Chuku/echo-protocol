// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {EchoHook} from "../core/EchoHook.sol";
import {MarketRegistry} from "../core/MarketRegistry.sol";
import {AgenticCommerce} from "../arc/AgenticCommerce.sol";

/**
 * @title UpgradeRevisionAndCloseGuard
 * @notice Bundled UUPS upgrade of all three Echo-controlled proxies to ship Final-tier
 *         worker-protection: a closeMarket guard + a Request-Revision loop.
 *
 *         1. AgenticCommerce — new `requestRevision(jobId, optParams)`: evaluator-only, flips a
 *            Submitted job back to Open (worker can re-submit), fires the afterAction hook, emits
 *            RevisionRequested. No funds move.
 *         2. EchoHook — on the requestRevision selector, reopens the Final-tier revision window once
 *            (ghost deadline → now + 60m); new `extendRevision(jobId)` lets the worker self-extend up
 *            to 3× by 45/30/15 min. New mappings `revisionUsed` / `revisionExtensions` appended at the
 *            STORAGE TAIL (slots 15-16; stakeBalance stays slot 14) → append-only, layout-safe. New
 *            events RevisionWindowOpened / RevisionExtended.
 *         3. MarketRegistry — `closeMarket` now reverts FinalJobStillSubmitted while any applicant's
 *            Final job is Submitted, forcing Accept / Reject / Request-revision first. Read-only guard,
 *            no new storage.
 *
 *         Proxy addresses are unchanged, so no re-wire and no SDK/env address change — only bump the
 *         two impl addresses in IMPLEMENTATIONS.arcTestnet after a real run.
 *
 * @dev DRY-RUN BY DEFAULT — forge sends only with --broadcast. EchoHook/MarketRegistry upgrades are
 *      onlyOwner; the AgenticCommerce upgrade is onlyRole(DEFAULT_ADMIN_ROLE). The echo-deployer holds
 *      all three roles (it deployed them), so one keystore can broadcast the bundle. Simulate with
 *      --sender <OWNER> first.
 *
 * STORAGE SAFETY (verify before broadcasting):
 *   forge clean && FOUNDRY_EXTRA_OUTPUT='["storageLayout"]' forge build
 *   forge inspect EchoHook storageLayout    # stakeBalance slot 14, revisionUsed 15, revisionExtensions 16
 *   forge inspect MarketRegistry storageLayout  # unchanged (no new storage)
 *
 * Usage (dry run):
 *   set -x ARC_TESTNET_RPC_URL "https://rpc.testnet.arc.network"
 *   forge script src/deployment/UpgradeRevisionAndCloseGuard.s.sol:UpgradeRevisionAndCloseGuard \
 *     --rpc-url $ARC_TESTNET_RPC_URL --sender <OWNER_ADDRESS>
 *
 * Usage (real upgrade — owner keystore):
 *   forge script src/deployment/UpgradeRevisionAndCloseGuard.s.sol:UpgradeRevisionAndCloseGuard \
 *     --rpc-url $ARC_TESTNET_RPC_URL --account echo-deployer --broadcast
 *
 * AFTER a real run: bump IMPLEMENTATIONS.arcTestnet.{echoHook,marketRegistry} in
 * packages/sdk/src/constants.ts to the printed impl addresses, and regenerate the ABIs
 * (forge inspect <C> abi) into packages/sdk/src/abis/{EchoHook,MarketRegistry,AgenticCommerce}.json.
 */
contract UpgradeRevisionAndCloseGuard is Script {
    // Live proxies on Arc Testnet (unchanged across all prior upgrades).
    address constant ECHO_HOOK_PROXY        = 0x6333b42426e5684BdB696BE2fF302AD5cfc84866;
    address constant MARKET_REGISTRY_PROXY  = 0x6CE0899056cB7e36524703289Da66A8ED0e333dc;
    // Echo's self-hosted AgenticCommerce test instance (Path C), read live from EchoHook.agenticCommerce.
    address constant AGENTIC_COMMERCE_PROXY = 0x1211eDC2E56D849c2d7a2E6EbeDeC6189835bF16;

    function run() external {
        console.log("=== Upgrade: Final-tier closeMarket guard + Request-Revision loop ===");

        vm.startBroadcast();

        // 1. AgenticCommerce — requestRevision
        AgenticCommerce newAcImpl = new AgenticCommerce();
        AgenticCommerce(AGENTIC_COMMERCE_PROXY).upgradeToAndCall(address(newAcImpl), "");

        // 2. EchoHook — revision window reopen + worker self-extensions
        EchoHook newHookImpl = new EchoHook();
        EchoHook(ECHO_HOOK_PROXY).upgradeToAndCall(address(newHookImpl), "");

        // 3. MarketRegistry — closeMarket guard
        MarketRegistry newRegImpl = new MarketRegistry();
        MarketRegistry(MARKET_REGISTRY_PROXY).upgradeToAndCall(address(newRegImpl), "");

        vm.stopBroadcast();

        console.log("AgenticCommerce NEW impl:", address(newAcImpl));
        console.log("EchoHook NEW impl:       ", address(newHookImpl));
        console.log("MarketRegistry NEW impl: ", address(newRegImpl));
        console.log("\nNext: bump IMPLEMENTATIONS.arcTestnet.{echoHook,marketRegistry} in constants.ts");
        console.log("and regenerate the three ABIs. If this was a dry run (no --broadcast), nothing was sent.");
    }
}
