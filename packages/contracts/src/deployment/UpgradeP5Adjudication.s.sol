// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {MarketRegistry} from "../core/MarketRegistry.sol";
import {DisputeResolver} from "../core/DisputeResolver.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title UpgradeP5Adjudication
 * @notice P5 (Adjudication ladder, spec §5) deployment. Three moving parts vs the prior
 *         single-impl upgrades:
 *
 *           1. LIBRARY LINKING (new this phase). MarketRegistry's Bounty + Direct Job lifecycles
 *              were extracted into the EchoBounty and EchoDirectJob delegatecall libraries (size
 *              relief — the registry dropped from 25,950 over-limit to 23,138 bytes, so via_ir is
 *              OFF again). `forge script` auto-deploys both libraries and links them into the new
 *              MarketRegistry impl in this same run; no manual --libraries flag is needed as long
 *              as the libraries are compiled alongside. The deployed library addresses are logged.
 *
 *           2. MarketRegistry impl upgrade (in place; live proxy unchanged). Adds the
 *              FindingStatus.Disputed enum value (appended, uint8 — layout-safe), the
 *              dispute callbacks (markFindingDisputed / resolveDisputedFinding /
 *              slashStakeAdjudicated, gated to the resolver), and the disputeResolver address at
 *              storage slot 22. Replaces the P1 adminSlashStake placeholder with the adjudicated
 *              path. EchoHook is UNCHANGED (slashStake / settleFinding already live since P1/P4).
 *
 *           3. NEW DisputeResolver sibling (fresh UUPS proxy). The staked-jury rung. Then wire it
 *              both ways: registry.setDisputeResolver(resolver) and resolver.setMarket(registry),
 *              plus the owner-appointed juror panel + config.
 *
 * @dev DRY-RUN BY DEFAULT. forge sends only with --broadcast. The impl upgrade + setDisputeResolver
 *      are onlyOwner — simulate as the owner (--sender) and broadcast with the owner keystore.
 *
 * STORAGE SAFETY (verify before broadcasting):
 *   forge clean
 *   forge inspect src/core/MarketRegistry.sol:MarketRegistry storageLayout
 *     # slots 0-21 IDENTICAL to live P4 (bounties slot 19, bountyFindings slot 20,
 *     # bountyPendingCount slot 21); disputeResolver appended at slot 22. The mappings did NOT move - only
 *     # their element TYPES were renamed (MarketRegistry.Bounty → EchoBounty.Bounty etc.), which is
 *     # a source-level change with identical layout. If any existing slot moved, DO NOT upgrade.
 *   forge inspect src/core/EchoHook.sol:EchoHook storageLayout  # unchanged (P5 adds no EchoHook storage)
 *
 * Configuration (edit before broadcasting):
 *   BOND_TOKEN  = Arc native USDC (default below)
 *   MIN_BOND    = minimum dispute bond (6-decimal USDC)
 *   VOTING_DAYS = juror voting window
 *   JURORS      = the initial owner-appointed panel (set via env or edit the array)
 *
 * Usage (dry run):
 *   set -x ARC_TESTNET_RPC_URL "https://rpc.testnet.arc.network"
 *   forge script src/deployment/UpgradeP5Adjudication.s.sol:UpgradeP5Adjudication \
 *     --rpc-url $ARC_TESTNET_RPC_URL --sender <OWNER_ADDRESS>
 *
 * Usage (real upgrade — owner keystore):
 *   forge script src/deployment/UpgradeP5Adjudication.s.sol:UpgradeP5Adjudication \
 *     --rpc-url $ARC_TESTNET_RPC_URL --account echo-deployer --broadcast
 *
 * AFTER a real run: record disputeResolver (proxy), the EchoBounty + EchoDirectJob library
 * addresses, and the new MarketRegistry impl in packages/sdk/src/constants.ts.
 */
contract UpgradeP5Adjudication is Script {
    // --- Live proxies (canonical) ---
    address constant MARKET_REGISTRY_PROXY = 0x6CE0899056cB7e36524703289Da66A8ED0e333dc;

    // --- DisputeResolver config ---
    address constant BOND_TOKEN = 0x3600000000000000000000000000000000000000; // Arc native USDC
    uint256 constant MIN_BOND = 25e6;     // $25 dispute bond
    uint64 constant VOTING_DAYS = 3 days;

    function run() external {
        console.log("=== Echo P5: Adjudication ladder (staked-jury rung) ===");

        // Jurors are seeded later via setJuror (no immediate need — they're only required to
        // vote/resolve a live dispute; deploy + wiring + open/counter all work with an empty panel).
        address[] memory panel = new address[](0);

        vm.startBroadcast();

        // (1)+(2) New MarketRegistry impl. forge auto-deploys+links EchoBounty + EchoDirectJob.
        MarketRegistry newRegistryImpl = new MarketRegistry();
        MarketRegistry(MARKET_REGISTRY_PROXY).upgradeToAndCall(address(newRegistryImpl), "");
        console.log("MarketRegistry NEW impl:", address(newRegistryImpl));

        // (3) Deploy the DisputeResolver behind a fresh UUPS proxy + initialize.
        DisputeResolver resolverImpl = new DisputeResolver();
        bytes memory initData = abi.encodeCall(DisputeResolver.initialize, (BOND_TOKEN, MIN_BOND, VOTING_DAYS));
        ERC1967Proxy resolverProxy = new ERC1967Proxy(address(resolverImpl), initData);
        DisputeResolver resolver = DisputeResolver(address(resolverProxy));
        console.log("DisputeResolver proxy:  ", address(resolver));
        console.log("DisputeResolver impl:   ", address(resolverImpl));

        // Wire the ladder both ways + seed the panel.
        MarketRegistry(MARKET_REGISTRY_PROXY).setDisputeResolver(address(resolver));
        resolver.setMarket(MARKET_REGISTRY_PROXY);
        for (uint256 i; i < panel.length; ++i) {
            resolver.setJuror(panel[i], true);
        }

        vm.stopBroadcast();

        console.log("\n=== P5 plan complete ===");
        console.log("DISPUTE_RESOLVER_PROXY=", address(resolver));
        console.log("MARKET_REGISTRY_IMPL=", address(newRegistryImpl));
        console.log("\nLibrary addresses (EchoBounty / EchoDirectJob) are in the broadcast/ run log");
        console.log("under 'Libraries' / CREATE transactions; copy them into constants.ts.");
        console.log("If this was a dry run (no --broadcast), nothing was sent.");
        console.log("After a real run: update IMPLEMENTATIONS + add disputeResolver in constants.ts,");
        console.log("and set the real juror panel (setJuror) + agent oracle (setAgentOracle).");
    }
}
