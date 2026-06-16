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

/** USDC base units → compact string truncated (not rounded) to 2 decimals, e.g. 22.001682 → "22.00".
 *  Used in the nav where space is tight. */
export function usdcShort(base: bigint | undefined): string {
  if (base === undefined) return '—';
  const neg = base < 0n;
  const abs = neg ? -base : base;
  const whole = abs / 1_000_000n;
  const frac2 = (abs % 1_000_000n) / 10_000n; // drop the last 4 digits → truncate to 2 dp
  return `${neg ? '-' : ''}${whole}.${frac2.toString().padStart(2, '0')}`;
}

/** Compact relative time from a unix-seconds timestamp, e.g. "3h ago", "2d ago", "just now". */
export function ago(unixSeconds: number | undefined): string {
  if (!unixSeconds) return '—';
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return 'just now';
  const units: [number, string][] = [
    [31_536_000, 'y'], [2_592_000, 'mo'], [86_400, 'd'], [3_600, 'h'], [60, 'm'],
  ];
  for (const [secs, label] of units) {
    if (diff >= secs) return `${Math.floor(diff / secs)}${label} ago`;
  }
  return 'just now';
}

/** Humanize a duration given in seconds, e.g. 604800 → "7 days", 86400 → "1 day". */
export function duration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '—';
  const units: [number, string][] = [
    [86_400, 'day'], [3_600, 'hour'], [60, 'minute'],
  ];
  for (const [secs, label] of units) {
    if (seconds >= secs) {
      const n = Math.round(seconds / secs);
      return `${n} ${label}${n === 1 ? '' : 's'}`;
    }
  }
  return `${seconds}s`;
}

/**
 * Mirror of MarketRegistry._calculateMinEscrow + the reveal-fee floor (MIN_REVEALS = 5), so the
 * console can pre-fill a valid escrow and never hit InsufficientEscrow. tiers = [reveal/R,
 * shortlist, final, ghost] in base units; maxApplicants is a plain count.
 */
export function recommendedEscrow(tiers: [bigint, bigint, bigint, bigint], maxApplicants: bigint): bigint {
  const sub = maxApplicants / 5n;      // estimatedSubstantive
  const short = maxApplicants / 20n;   // estimatedShortlist
  const fin = maxApplicants / 50n;     // estimatedFinal
  const calcMin = sub * tiers[0] + short * tiers[1] + fin * tiers[2] + tiers[3];
  const revealFloor = tiers[0] * 5n;   // escrow must fund at least MIN_REVEALS reveals
  return calcMin > revealFloor ? calcMin : revealFloor;
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

/** Tailwind classes for a mode pill: 0 Open/Reveal (indigo), 1 DirectJob (emerald), 2 Bounty (amber). */
export const MODE_TAG_CLASS = [
  'bg-indigo-100 text-indigo-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
] as const;
export const modeTagClass = (m: number | bigint) =>
  MODE_TAG_CLASS[Number(m)] ?? 'bg-gray-100 text-gray-600';

/** One-line "when to use this" blurb for the create type-picker (index = EchoMode). */
export const MODE_BLURBS = [
  'Open call — many applicants compete through reveal + tiers. You fund one escrow.',
  'One known worker, paid per milestone. Best when you already picked who.',
  'Open submissions, pay each accepted finding from a pool. Best for bug bounties.',
] as const;

/** Bounty FindingStatus / Milestone status / RevealStatus label helpers (enum order = contract). */
export const FINDING_STATUS = ['Pending', 'Accepted', 'Rejected', 'Disputed'] as const;
export const MILESTONE_STATUS = ['Pending', 'Submitted', 'Released'] as const;

export const isZeroAddr = (a?: string) => !a || /^0x0{40}$/i.test(a);
export type { Address };
