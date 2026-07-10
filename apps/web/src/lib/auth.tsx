'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
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
 * proves control of it. We prompt for that signature ONCE automatically, right after a wallet
 * connects (or after a stored session expires) — the common web3 pattern — and never gate individual
 * actions behind it. Content-channel writes then ride the resulting session token.
 *
 * Rollout is optional-first: the indexer still accepts unauthenticated content calls unless
 * REQUIRE_AUTH is set, so declining the prompt doesn't break anything today.
 */

// idle: nothing to do · prompting: waiting on the wallet signature · signed-in: proven
// declined: user dismissed the wallet prompt (we go quiet, offer a manual re-try) · error: failed
type AuthStatus = 'idle' | 'prompting' | 'signed-in' | 'declined' | 'error';

interface AuthValue {
  address: string | null;
  status: AuthStatus;
  isSignedIn: boolean;
  /** Last error message when status === 'error'. */
  error: string | null;
  /** Manually (re)start sign-in — used by the toast's "Sign in" button. */
  signIn: () => Promise<void>;
  /** Ensure a session exists, signing in if needed. Kept for callers that truly require proof. */
  ensureSignedIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Dismiss the current prompt/error toast without signing (marks this wallet as declined). */
  dismiss: () => void;
}

const Ctx = createContext<AuthValue>({
  address: null,
  status: 'idle',
  isSignedIn: false,
  error: null,
  signIn: async () => {},
  ensureSignedIn: async () => {},
  signOut: async () => {},
  dismiss: () => {},
});

const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4000/graphql';
const AUTH_BASE = INDEXER_URL.replace(/\/graphql\/?$/, ''); // /auth/* lives beside /graphql

/** viem/wallets throw a recognizable shape when the user clicks "Cancel" on the signature. */
function isUserRejection(e: unknown): boolean {
  const msg = (e as Error)?.message?.toLowerCase() ?? '';
  const name = (e as { name?: string })?.name ?? '';
  const code = (e as { code?: number })?.code;
  return code === 4001 || name === 'UserRejectedRequestError' || msg.includes('reject') || msg.includes('denied') || msg.includes('cancel');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { sdk, account, walletReady } = useEcho();
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  // Wallets this session already declined — so we don't re-pop the prompt on every render. Cleared
  // naturally when the account changes (a fresh connect is a fresh chance).
  const declinedRef = useRef<Set<string>>(new Set());

  const reset = useCallback(() => {
    setSessionToken(null);
    setAddress(null);
    setStatus('idle');
    setError(null);
  }, []);

  // Rehydrate a stored session when the connected account changes, then validate it server-side.
  useEffect(() => {
    if (!account) { reset(); return; }
    const stored = readStoredSession(account);
    if (!stored || stored.address.toLowerCase() !== account.toLowerCase()) { reset(); return; }

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
    setError(null);
    setStatus('prompting');
    try {
      // 1. one-time nonce from the server
      const nonceRes = await fetch(`${AUTH_BASE}/auth/nonce`, { method: 'POST' });
      if (!nonceRes.ok) throw new Error('Could not start sign-in');
      const { nonce } = await nonceRes.json();

      // 2. build + sign the EIP-4361 message (EOA or Circle passkey — both go through signSiwe)
      const domain = typeof window !== 'undefined' ? window.location.host : 'app.echoprotocol.site';
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
        const { error: err } = await verifyRes.json().catch(() => ({ error: 'verification failed' }));
        throw new Error(err || 'verification failed');
      }
      const { token, address: proven, expiresAt } = await verifyRes.json();

      persistSession({ token, address: proven, expiresAt });
      setSessionToken(token);
      setAddress(proven);
      setStatus('signed-in');
    } catch (e) {
      if (isUserRejection(e)) {
        // User clicked Cancel — go quiet and remember so we don't nag on re-render.
        if (account) declinedRef.current.add(account.toLowerCase());
        setStatus('declined');
      } else {
        setError((e as Error).message || 'Sign-in failed');
        setStatus('error');
      }
    }
  }, [account, sdk]);

  const isSignedIn = status === 'signed-in' && !!address && address.toLowerCase() === account?.toLowerCase();

  // Auto-prompt: once the wallet can sign and we have no live session for it, kick off SIWE — unless
  // the user already declined this wallet this session. Fires on connect and after a session expires.
  useEffect(() => {
    if (!account || !walletReady) return;
    if (status !== 'idle') return; // signed-in / prompting / declined / error → don't re-fire
    if (declinedRef.current.has(account.toLowerCase())) return;
    void signIn();
  }, [account, walletReady, status, signIn]);

  const ensureSignedIn = useCallback(async () => {
    if (isSignedIn) return;
    await signIn();
  }, [isSignedIn, signIn]);

  const dismiss = useCallback(() => {
    if (account) declinedRef.current.add(account.toLowerCase());
    setStatus((s) => (s === 'signed-in' ? s : 'declined'));
    setError(null);
  }, [account]);

  const signOut = useCallback(async () => {
    const token = getSessionToken();
    if (token) {
      fetch(`${AUTH_BASE}/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    if (account) { clearStoredSession(account); declinedRef.current.add(account.toLowerCase()); }
    reset();
    setStatus('declined'); // stay signed-out until an explicit re-sign, don't auto-re-prompt
  }, [account, reset]);

  return (
    <Ctx.Provider value={{ address, status, isSignedIn, error, signIn, ensureSignedIn, signOut, dismiss }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
