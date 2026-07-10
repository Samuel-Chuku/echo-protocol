'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Address } from 'viem';
import { useEcho } from './sdk';
import {
  getSessionToken,
  setSessionToken,
  persistSession,
  readStoredSession,
  clearStoredSession,
} from './session-token';

/**
 * SIWE (Sign-In With Ethereum) session state. Connecting a wallet only asserts an address; SIGNING
 * proves control of it. Content-channel writes/reads are attributed to an address, so they must be
 * backed by a proven session — this context owns that proof for the whole app.
 *
 * Rollout is optional-first: the indexer still accepts unauthenticated content calls (legacy path)
 * unless REQUIRE_AUTH is set, so sign-in is prompted lazily (on the first content action) rather
 * than forced at connect time.
 */

type AuthStatus = 'idle' | 'signing' | 'signed-in';

interface AuthValue {
  /** The proven address of the active session, or null when not signed in. */
  address: string | null;
  status: AuthStatus;
  isSignedIn: boolean;
  /** Run the full SIWE handshake (nonce → sign → verify). Throws on failure/rejection. */
  signIn: () => Promise<void>;
  /** Ensure a session exists, signing in if needed. No-op when already signed in. */
  ensureSignedIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthValue>({
  address: null,
  status: 'idle',
  isSignedIn: false,
  signIn: async () => {},
  ensureSignedIn: async () => {},
  signOut: async () => {},
});

const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4000/graphql';
const AUTH_BASE = INDEXER_URL.replace(/\/graphql\/?$/, ''); // /auth/* lives beside /graphql

export function AuthProvider({ children }: { children: ReactNode }) {
  const { sdk, account } = useEcho();
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>('idle');

  const reset = useCallback(() => {
    setSessionToken(null);
    setAddress(null);
    setStatus('idle');
  }, []);

  // Rehydrate a stored session when the connected account changes, then validate it server-side.
  // A wallet switch (or disconnect) drops any session that isn't for the now-active address.
  useEffect(() => {
    if (!account) { reset(); return; }
    const stored = readStoredSession(account);
    if (!stored || stored.address.toLowerCase() !== account.toLowerCase()) { reset(); return; }

    // Optimistically adopt it so the UI shows signed-in without a flash, then confirm with the server.
    setSessionToken(stored.token);
    setAddress(stored.address);
    setStatus('signed-in');

    let active = true;
    fetch(`${AUTH_BASE}/auth/session`, { headers: { authorization: `Bearer ${stored.token}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error('invalid');
        const { address: proven } = await r.json();
        if (proven.toLowerCase() !== account.toLowerCase()) throw new Error('mismatch');
      })
      .catch(() => {
        if (!active) return;
        clearStoredSession(account);
        reset();
      });
    return () => { active = false; };
  }, [account, reset]);

  const signIn = useCallback(async () => {
    if (!account) throw new Error('Connect a wallet first');
    setStatus('signing');
    try {
      // 1. one-time nonce from the server
      const nonceRes = await fetch(`${AUTH_BASE}/auth/nonce`, { method: 'POST' });
      if (!nonceRes.ok) throw new Error('could not start sign-in');
      const { nonce } = await nonceRes.json();

      // 2. build + sign the EIP-4361 message (EOA or Circle passkey — both go through signSiwe)
      const domain = typeof window !== 'undefined' ? window.location.host : 'echoprotocol.site';
      const uri = typeof window !== 'undefined' ? window.location.origin : `https://${domain}`;
      const message = sdk.buildSiweMessage({ address: account as Address, domain, uri, nonce });
      const signature = await sdk.signSiwe(message, account as Address);

      // 3. exchange the signature for a session token
      const verifyRes = await fetch(`${AUTH_BASE}/auth/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });
      if (!verifyRes.ok) {
        const { error } = await verifyRes.json().catch(() => ({ error: 'verification failed' }));
        throw new Error(error || 'verification failed');
      }
      const { token, address: proven, expiresAt } = await verifyRes.json();

      persistSession({ token, address: proven, expiresAt });
      setSessionToken(token);
      setAddress(proven);
      setStatus('signed-in');
    } catch (e) {
      setStatus('idle');
      throw e;
    }
  }, [account, sdk]);

  const isSignedIn = status === 'signed-in' && !!address && address.toLowerCase() === account?.toLowerCase();

  const ensureSignedIn = useCallback(async () => {
    if (isSignedIn) return;
    await signIn();
  }, [isSignedIn, signIn]);

  const signOut = useCallback(async () => {
    const token = getSessionToken();
    if (token) {
      // Best-effort server revoke; local clear is what actually logs the UI out.
      fetch(`${AUTH_BASE}/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    if (account) clearStoredSession(account);
    reset();
  }, [account, reset]);

  return (
    <Ctx.Provider value={{ address, status, isSignedIn, signIn, ensureSignedIn, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
