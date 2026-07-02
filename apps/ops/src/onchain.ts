import { getAddress, isAddress } from 'viem';
import { config, writesEnabled } from './config.js';
import {
  publicClient,
  walletClient,
  ownerAccount,
  DISPUTE_RESOLVER_ABI,
  VALIDATION_GATE_ABI,
  ATTRIBUTION_PAYOUT_ABI,
} from './chain.js';

export class OnchainError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function assertWrites(): void {
  if (!writesEnabled || !walletClient || !ownerAccount) {
    throw new OnchainError('on-chain writes disabled: DEPLOYER_PRIVATE_KEY is not set on the server', 503);
  }
}

function assertAddress(addr: string): `0x${string}` {
  if (!isAddress(addr)) throw new OnchainError(`invalid address: ${addr}`);
  return getAddress(addr);
}

/**
 * Simulate against the live contract (which surfaces the real revert reason, e.g. not-owner) and
 * only then broadcast. Returns the tx hash. All three actions are owner-only on Arc testnet.
 */
async function send(
  address: `0x${string}`,
  abi: typeof DISPUTE_RESOLVER_ABI | typeof VALIDATION_GATE_ABI | typeof ATTRIBUTION_PAYOUT_ABI,
  functionName: string,
  args: readonly unknown[],
): Promise<`0x${string}`> {
  assertWrites();
  try {
    const { request } = await publicClient.simulateContract({
      account: ownerAccount,
      address,
      abi: abi as never,
      functionName: functionName as never,
      args: args as never,
    });
    return await walletClient!.writeContract(request as never);
  } catch (e) {
    const msg = (e as Error).message?.split('\n')[0] ?? String(e);
    throw new OnchainError(`tx reverted/failed: ${msg}`, 502);
  }
}

export function seatJuror(juror: string, active: boolean): Promise<`0x${string}`> {
  return send(config.contracts.disputeResolver, DISPUTE_RESOLVER_ABI, 'setJuror', [assertAddress(juror), active]);
}

export function setModeAStake(enabled: boolean): Promise<`0x${string}`> {
  return send(config.contracts.disputeResolver, DISPUTE_RESOLVER_ABI, 'setModeAStakeEnabled', [enabled]);
}

export function setAttester(attester: string, allowed: boolean): Promise<`0x${string}`> {
  return send(config.contracts.validationGate, VALIDATION_GATE_ABI, 'setAttester', [assertAddress(attester), allowed]);
}

export function setDisputeConfig(minBond: bigint, votingPeriod: bigint): Promise<`0x${string}`> {
  if (minBond < 0n) throw new OnchainError('minBond must be >= 0');
  if (votingPeriod <= 0n) throw new OnchainError('votingPeriod must be > 0 seconds');
  return send(config.contracts.disputeResolver, DISPUTE_RESOLVER_ABI, 'setConfig', [minBond, votingPeriod]);
}

export function setAgentOracle(oracle: string): Promise<`0x${string}`> {
  return send(config.contracts.disputeResolver, DISPUTE_RESOLVER_ABI, 'setAgentOracle', [assertAddress(oracle)]);
}

export function setAttributionCeiling(ceilingBps: number): Promise<`0x${string}`> {
  if (!Number.isInteger(ceilingBps) || ceilingBps < 0 || ceilingBps > 10_000) {
    throw new OnchainError('ceilingBps must be an integer 0–10000');
  }
  return send(config.contracts.attributionPayout, ATTRIBUTION_PAYOUT_ABI, 'setCeiling', [ceilingBps]);
}
