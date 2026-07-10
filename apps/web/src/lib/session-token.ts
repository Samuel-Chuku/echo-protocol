'use client';

/**
 * Module-level holder for the active SIWE session token. The urql client is created outside React
 * (see gql.ts) so it can't read React state — it reads the token from here at request time instead.
 * The AuthProvider is the single writer: it sets the token on sign-in / clears it on sign-out, and
 * mirrors it to localStorage so a page reload can rehydrate + re-validate.
 *
 * Stored per-address (`echo.siwe.<address>`): a SIWE session proves control of ONE address, so
 * switching wallets must not carry the prior wallet's session.
 */

export interface StoredSession {
  token: string;
  address: string;
  expiresAt: number; // unix seconds
}

let current: string | null = null;

export function getSessionToken(): string | null {
  return current;
}

export function setSessionToken(token: string | null): void {
  current = token;
}

const keyFor = (address: string) => `echo.siwe.${address.toLowerCase()}`;

export function persistSession(s: StoredSession): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(keyFor(s.address), JSON.stringify(s));
}

export function readStoredSession(address: string): StoredSession | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(keyFor(address));
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as StoredSession;
    if (s.expiresAt * 1000 <= Date.now()) { localStorage.removeItem(keyFor(address)); return null; }
    return s;
  } catch {
    return null;
  }
}

export function clearStoredSession(address: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(keyFor(address));
}
