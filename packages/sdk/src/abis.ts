/**
 * Echo Protocol Smart Contract ABIs (auto-generated from compiled contracts)
 *
 * To regenerate after contract changes:
 *   cd packages/contracts
 *   forge build
 *   python3 -c "
 *     import json, os
 *     for c in ['MarketRegistry','EchoHook','ParticipationReceipt']:
 *       with open(f'out/{c}.sol/{c}.json') as f: data=json.load(f)
 *       with open(f'../sdk/src/abis/{c}.json','w') as f: json.dump(data['abi'],f,indent=2)
 *   "
 */
import MarketRegistryJson from './abis/MarketRegistry.json';
import EchoHookJson from './abis/EchoHook.json';
import ParticipationReceiptJson from './abis/ParticipationReceipt.json';

export const MarketRegistryABI = MarketRegistryJson as const;
export const EchoHookABI = EchoHookJson as const;
export const ParticipationReceiptABI = ParticipationReceiptJson as const;
