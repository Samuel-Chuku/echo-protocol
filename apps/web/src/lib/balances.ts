'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Address } from 'viem';
import { useEcho } from './sdk';

/**
 * Live USDC balances, read DIRECTLY on-chain (USDC.balanceOf via the public client) — never Circle's
 * API, which only reports monitored tokens and lags funding (the "deposited but shows $0" bug).
 *
 * Two refresh triggers:
 *   1. a 5s poll while the component is mounted, and
 *   2. `bumpBalances()` — a global nudge fired after every app transaction so balances update the
 *      moment a tx lands instead of waiting out the poll interval.
 */

const POLL_MS = 5000;

// Module-level subscriber registry so any code (e.g. the tx overlay) can nudge every mounted balance.
const subscribers = new Set<() => void>();

/** Refresh every mounted useUsdcBalance immediately. Call after any transaction completes. */
export function bumpBalances(): void {
  subscribers.forEach((fn) => fn());
}

/** Subscribe an external refresher (e.g. the nav balance) to the bump bus. Pair with offBalanceBump. */
export function onBalanceBump(fn: () => void): void { subscribers.add(fn); }
export function offBalanceBump(fn: () => void): void { subscribers.delete(fn); }

/**
 * Live USDC balance (base units) of `address`, polled every 5s + refreshed on bumpBalances().
 * Returns null while first loading or when no address. `refresh` forces an immediate re-read.
 */
export function useUsdcBalance(address: Address | string | null | undefined): { balance: bigint | null; refresh: () => void } {
  const { sdk } = useEcho();
  const [balance, setBalance] = useState<bigint | null>(null);

  const refresh = useCallback(() => {
    if (!address) { setBalance(null); return; }
    sdk.usdcBalanceOf(address as Address).then((b) => setBalance(b as bigint)).catch(() => {});
  }, [sdk, address]);

  useEffect(() => {
    refresh();
    if (!address) return;
    const iv = setInterval(refresh, POLL_MS);
    subscribers.add(refresh);
    return () => { clearInterval(iv); subscribers.delete(refresh); };
  }, [refresh, address]);

  return { balance, refresh };
}
