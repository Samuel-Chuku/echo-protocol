/**
 * Echo Protocol Smart Contract ABIs (auto-generated from compiled contracts)
 *
 * To regenerate after contract changes:
 *   cd packages/contracts
 *   forge build
 *   python3 -c "
 *     import json, os
 *     for c in ['MarketRegistry','EchoHook','ParticipationReceipt','AttributionRegistry','AttributionPayout','DisputeResolver']:
 *       with open(f'out/{c}.sol/{c}.json') as f: data=json.load(f)
 *       with open(f'../sdk/src/abis/{c}.json','w') as f: json.dump(data['abi'],f,indent=2)
 *   "
 */
import type { Abi } from 'viem';
import MarketRegistryJson from './abis/MarketRegistry.json';
import EchoHookJson from './abis/EchoHook.json';
import ParticipationReceiptJson from './abis/ParticipationReceipt.json';
import AttributionRegistryJson from './abis/AttributionRegistry.json';
import AttributionPayoutJson from './abis/AttributionPayout.json';
import DisputeResolverJson from './abis/DisputeResolver.json';
// Minimal hand-rolled subset of Arc's IAgenticCommerce — just the surface the UI drives
// (submit/complete/reject/getJob + JobCreated/Submitted/Completed events). The full ABI
// is huge and admin-gated; Echo only needs the worker→provider and requester→evaluator legs.
import AgenticCommerceJson from './abis/AgenticCommerce.json';

// Typed as `Abi` (not `as const`) — the JSON is imported at runtime, so a const assertion is
// invalid (TS1355). `satisfies Abi` keeps viem's call typing while accepting the JSON shape.
export const MarketRegistryABI = MarketRegistryJson as Abi;
export const EchoHookABI = EchoHookJson as Abi;
export const ParticipationReceiptABI = ParticipationReceiptJson as Abi;
export const AttributionRegistryABI = AttributionRegistryJson as Abi;
export const AttributionPayoutABI = AttributionPayoutJson as Abi;
export const DisputeResolverABI = DisputeResolverJson as Abi;
export const AgenticCommerceABI = AgenticCommerceJson as Abi;
