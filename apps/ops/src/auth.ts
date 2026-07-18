import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';
import { verifyTotp } from './totp.js';
import { createSession, validateSession, loginAllowed, recordFailure, clearFailures } from './session.js';

function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.ip || 'unknown';
}

/**
 * POST /api/login — exchange a valid authenticator code for a short-lived session token.
 * Rate-limited per IP so a 6-digit code can't be brute-forced.
 */
export function handleLogin(req: Request, res: Response): void {
  if (!config.totpSecret) {
    res.status(503).json({ error: 'TOTP not configured — run `pnpm --filter @echo/ops totp:setup` and set OPS_TOTP_SECRET' });
    return;
  }
  const ip = clientIp(req);
  const gate = loginAllowed(ip);
  if (!gate.allowed) {
    res.status(429).json({ error: `too many attempts — retry in ${gate.retryAfterSec}s` });
    return;
  }
  const code = String(req.body?.code ?? '');
  if (!verifyTotp(config.totpSecret, code)) {
    recordFailure(ip);
    res.status(401).json({ error: 'invalid code' });
    return;
  }
  clearFailures(ip);
  const { token, expiresAt } = createSession(ip);
  res.json({ token, expiresAt });
}

/**
 * Gate for every sensitive route. Requires a live session token (issued by /api/login). Fails
 * closed if TOTP was never configured.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!config.totpSecret) {
    res.status(503).json({ error: 'admin disabled — OPS_TOTP_SECRET is not set on the server' });
    return;
  }
  // The session token rides in x-ops-token, NOT Authorization: the Caddy basic_auth gate in front
  // of this app owns the Authorization header (Basic …), and a request can only carry one — a
  // Bearer token there knocks out the Basic credentials and Caddy 401s every API call (the
  // "basic-auth dialog keeps reappearing after TOTP login" bug). Bearer is kept as a fallback for
  // direct/ungated access (local dev, curl inside the compose network).
  const header = req.header('authorization') || '';
  const token = req.header('x-ops-token')?.trim()
    || (header.startsWith('Bearer ') ? header.slice(7).trim() : '');
  if (!validateSession(token, clientIp(req))) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}
