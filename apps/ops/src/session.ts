import { randomBytes } from 'node:crypto';
import { config } from './config.js';

// In-memory session store. Single-process dashboard, so a Map is plenty; a server restart simply
// invalidates all sessions (you re-enter a code). Tokens are 256-bit random, so plain Map.get
// lookups leak nothing useful via timing.
const sessions = new Map<string, number>(); // token -> expiresAt (ms)

export function createSession(): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + config.sessionTtlMin * 60_000;
  sessions.set(token, expiresAt);
  return { token, expiresAt };
}

export function validateSession(token: string): boolean {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

// Drop expired sessions periodically so the Map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of sessions) if (now > exp) sessions.delete(t);
}, 60_000).unref();

// ── Login throttle ──────────────────────────────────────────────────────────
// 6-digit codes are brute-forceable without a limiter. Lock an IP out for a cooldown after too many
// failures within a window. In-memory, per-process — fine for a single-instance admin tool.
const MAX_FAILS = 5;
const WINDOW_MS = 5 * 60_000;
const fails = new Map<string, { count: number; resetAt: number }>();

export function loginAllowed(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const rec = fails.get(ip);
  if (rec && now < rec.resetAt && rec.count >= MAX_FAILS) {
    return { allowed: false, retryAfterSec: Math.ceil((rec.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function recordFailure(ip: string): void {
  const now = Date.now();
  const rec = fails.get(ip);
  if (!rec || now >= rec.resetAt) fails.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  else rec.count++;
}

export function clearFailures(ip: string): void {
  fails.delete(ip);
}
