import { keccak256, toHex, type Address } from 'viem';

/** Arc testnet explorer base. */
export const ARCSCAN = 'https://testnet.arcscan.app';
export const txLink = (hash: string) => `${ARCSCAN}/tx/${hash}`;
export const addrLink = (addr: string) => `${ARCSCAN}/address/${addr}`;

/** USDC is 6-decimal. base units (bigint) ⇄ human string. */
export function usdc(base: bigint | number | undefined): string {
  if (base === undefined) return '—';
  const v = typeof base === 'bigint' ? base : BigInt(Math.round(base));
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/** Parse a human USDC string ("12.5") into 6-decimal base units. */
export function toUnits(human: string): bigint {
  const [w, f = ''] = human.trim().split('.');
  const frac = (f + '000000').slice(0, 6);
  return BigInt(w || '0') * 1_000_000n + BigInt(frac || '0');
}

/** Hash an arbitrary string into a bytes32 scope/submission/deliverable hash. */
export function scope(s: string): `0x${string}` {
  return keccak256(toHex(s));
}

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');

/** A 32-byte tx hash looks like 0x + 64 hex chars; used to decide whether to show an Arcscan link. */
export const isTxHash = (s: unknown): s is string => typeof s === 'string' && /^0x[0-9a-fA-F]{64}$/.test(s);

export const MODE_NAMES = ['Open / Reveal', 'Direct Job', 'Bounty'] as const;
export const modeName = (m: number | bigint) => MODE_NAMES[Number(m)] ?? `mode ${m}`;

/** Bounty FindingStatus / Milestone status / RevealStatus label helpers (enum order = contract). */
export const FINDING_STATUS = ['Pending', 'Accepted', 'Rejected', 'Disputed'] as const;
export const MILESTONE_STATUS = ['Pending', 'Submitted', 'Released'] as const;

export const isZeroAddr = (a?: string) => !a || /^0x0{40}$/i.test(a);
export type { Address };
