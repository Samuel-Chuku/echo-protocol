// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {DisputeResolver} from "../core/DisputeResolver.sol";
import {EchoHook} from "../core/EchoHook.sol";
import {MarketRegistry} from "../core/MarketRegistry.sol";

/**
 * @title UpgradeTierRejectionRecourse
 * @notice Bundled UUPS upgrade of the three Echo-controlled proxies to ship worker-recourse on an
 *         unfair Final-tier rejection — routed through the EXISTING staked-jury panel (no new
 *         adjudication system). A worker whose Final job was rejected opens a bonded dispute; the
 *         requester counters; jurors vote; the verdict either pays the worker the tier amount from
 *         escrow (rejection overturned) or confirms the rejection (escrow refunds the requester on
 *         close). LOCKED DECISION: a TIE pays the WORKER (benefit-of-the-doubt, forOpener >= against).
 *
 *         1. DisputeResolver — new `Subject.TierJobRejection` (appended enum value) + opener
 *            `openTierJobDispute(marketId, jobId, bond)`; resolve() routes the verdict to the registry.
 *            The `disputes` mapping was made internal (visibility only — `getDispute` already exposes
 *            the struct; trims the 13-value auto-getter that sat at the non-IR stack limit). NO new
 *            storage; the Dispute struct is unchanged (`target` reused as the jobId).
 *         2. MarketRegistry — new `markTierJobDisputed` / `resolveTierJobDispute` IDisputeAdjudicable
 *            callbacks, a `tierJobDisputed` mapping appended at the STORAGE TAIL (append-only), and a
 *            closeMarket guard (`FinalJobDisputed`) blocking reclaim while a tier dispute is open.
 *         3. EchoHook — new `settleDisputedTier(jobId, workerWon)` (pays the worker via the normal
 *            `_settle` leg on a win) + a `disputeSettled` flag APPENDED to the `MarketContext` struct
 *            (mapping-stored, last field → layout-safe) and a matching triggerGhost mutual-exclusion
 *            guard. New event DisputedTierSettled.
 *
 *         AgenticCommerce is NOT upgraded — its `reject` already exists on the live instance; the
 *         test `reject` driver is mock-only. Proxy addresses are unchanged, so no re-wire.
 *
 * @dev DRY-RUN BY DEFAULT — forge sends only with --broadcast. All three upgrades are onlyOwner; the
 *      echo-deployer holds owner on all three, so one keystore broadcasts the bundle.
 *
 * STORAGE SAFETY (verify before broadcasting):
 *   forge clean && FOUNDRY_EXTRA_OUTPUT='["storageLayout"]' forge build
 *   forge inspect DisputeResolver storageLayout  # unchanged (visibility-only on `disputes`)
 *   forge inspect MarketRegistry  storageLayout  # tierJobDisputed appended at the tail
 *   forge inspect EchoHook        storageLayout  # ctx unchanged at top level (MarketContext gained a
 *                                                # trailing bool inside the mapped struct — layout-safe)
 *
 * Usage (dry run):
 *   set -x ARC_TESTNET_RPC_URL "https://rpc.testnet.arc.network"
 *   forge script src/deployment/UpgradeTierRejectionRecourse.s.sol:UpgradeTierRejectionRecourse \
 *     --rpc-url $ARC_TESTNET_RPC_URL --sender <OWNER_ADDRESS>
 *
 * Usage (real upgrade — owner keystore):
 *   forge script src/deployment/UpgradeTierRejectionRecourse.s.sol:UpgradeTierRejectionRecourse \
 *     --rpc-url $ARC_TESTNET_RPC_URL --account echo-deployer --broadcast
 *
 * AFTER a real run: bump IMPLEMENTATIONS.arcTestnet.{disputeResolver,echoHook,marketRegistry} in
 * packages/sdk/src/constants.ts to the printed impl addresses, and regenerate the ABIs
 * (forge inspect <C> abi) into packages/sdk/src/abis/{DisputeResolver,EchoHook,MarketRegistry}.json.
 */
contract UpgradeTierRejectionRecourse is Script {
    // Live proxies on Arc Testnet (unchanged across all prior upgrades).
    address constant DISPUTE_RESOLVER_PROXY = 0x8d04351F57C4BF2089B2F1E53dBe569e3AeF8EC8;
    address constant MARKET_REGISTRY_PROXY  = 0x6CE0899056cB7e36524703289Da66A8ED0e333dc;
    address constant ECHO_HOOK_PROXY        = 0x6333b42426e5684BdB696BE2fF302AD5cfc84866;

    function run() external {
        console.log("=== Upgrade: worker-recourse on Final-tier rejection (tie pays the worker) ===");

        vm.startBroadcast();

        // 1. DisputeResolver — Subject.TierJobRejection + openTierJobDispute + verdict routing
        DisputeResolver newResolverImpl = new DisputeResolver();
        DisputeResolver(DISPUTE_RESOLVER_PROXY).upgradeToAndCall(address(newResolverImpl), "");

        // 2. EchoHook — settleDisputedTier + disputeSettled flag + triggerGhost guard
        EchoHook newHookImpl = new EchoHook();
        EchoHook(ECHO_HOOK_PROXY).upgradeToAndCall(address(newHookImpl), "");

        // 3. MarketRegistry — tier-dispute callbacks + tierJobDisputed mapping + closeMarket guard
        MarketRegistry newRegImpl = new MarketRegistry();
        MarketRegistry(MARKET_REGISTRY_PROXY).upgradeToAndCall(address(newRegImpl), "");

        vm.stopBroadcast();

        console.log("DisputeResolver NEW impl:", address(newResolverImpl));
        console.log("EchoHook NEW impl:       ", address(newHookImpl));
        console.log("MarketRegistry NEW impl: ", address(newRegImpl));
        console.log("\nNext: bump IMPLEMENTATIONS.arcTestnet.{disputeResolver,echoHook,marketRegistry} in");
        console.log("constants.ts and regenerate the three ABIs. If this was a dry run (no --broadcast),");
        console.log("nothing was sent.");
    }
}
