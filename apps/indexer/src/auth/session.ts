import { randomBytes } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { authNonces, userSessions } from '../db/schema.js';
import { config } from '../config.js';

const now = () => Math.floor(Date.now() / 1000);
const NONCE_TTL_SEC = 5 * 60; // a SIWE message must be signed + verified within 5 minutes

/**
 * Mint a one-time nonce, persist it, and return it. The client embeds this in the SIWE message it
 * signs; `consumeNonce` deletes it on verify so a captured signature can't be replayed.
 */
export async function issueNonce(nonce: string): Promise<void> {
  await db.insert(authNonces).values({ nonce, createdAt: now() }).onConflictDoNothing();
}

/**
 * Atomically consume a nonce: returns true only if it existed AND was fresh. Deletes it either way
 * (a stale nonce is garbage). A DELETE ... RETURNING makes the check-and-delete a single round trip
 * so two concurrent verifies can't both succeed on one nonce.
 */
export async function consumeNonce(nonce: string): Promise<boolean> {
  const deleted = await db.delete(authNonces).where(eq(authNonces.nonce, nonce)).returning();
  if (deleted.length === 0) return false;
  return now() - deleted[0].createdAt <= NONCE_TTL_SEC;
}

export interface Session {
  token: string;
  address: string;
  expiresAt: number; // unix seconds
}

/** Create a session for a *proven* address (post-SIWE). Bound to the issuing IP. */
export async function createSession(address: string, ip: string): Promise<Session> {
  const token = randomBytes(32).toString('hex');
  const issuedAt = now();
  const expiresAt = issuedAt + config.sessionTtlMin * 60;
  await db.insert(userSessions).values({
    token,
    address: address.toLowerCase(),
    ip,
    issuedAt,
    expiresAt,
  });
  return { token, address: address.toLowerCase(), expiresAt };
}

/**
 * Resolve a bearer token to its proven address, or null if missing/expired/replayed-from-another-IP.
 * Expired rows are deleted lazily on lookup.
 */
export async function resolveSession(token: string, ip: string): Promise<{ address: string } | null> {
  if (!token) return null;
  const [row] = await db.select().from(userSessions).where(eq(userSessions.token, token)).limit(1);
  if (!row) return null;
  if (now() > row.expiresAt) {
    await db.delete(userSessions).where(eq(userSessions.token, token));
    return null;
  }
  // Pinned to the issuing IP — a leaked token can't be replayed from a different host. Don't delete
  // on mismatch: a legit user whose IP flips just re-signs; deleting would let a thief force-logout.
  if (row.ip !== ip) return null;
  return { address: row.address };
}

export async function destroySession(token: string): Promise<void> {
  if (!token) return;
  await db.delete(userSessions).where(eq(userSessions.token, token));
}

/** Drop expired sessions + stale nonces so the tables can't grow unbounded. */
export async function sweepAuth(): Promise<void> {
  const t = now();
  await db.delete(userSessions).where(lt(userSessions.expiresAt, t));
  await db.delete(authNonces).where(lt(authNonces.createdAt, t - NONCE_TTL_SEC));
}

// Periodic sweep — cheap, runs alongside the ingest loop. unref so it never holds the process open.
setInterval(() => {
  sweepAuth().catch((e) => console.error('[auth] sweep failed:', (e as Error).message));
}, 10 * 60_000).unref();
