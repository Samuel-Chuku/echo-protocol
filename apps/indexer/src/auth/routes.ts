import { type Express, type Request, type Response } from 'express';
import { generateNonce } from 'siwe';
import { verifySiwe } from './siwe.js';
import { issueNonce, createSession, resolveSession, destroySession } from './session.js';

/** First forwarded hop (Caddy sets X-Forwarded-For), else the socket IP. */
function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.ip || 'unknown';
}

/** Pull the bearer token from an Authorization header. */
export function bearer(req: Request): string {
  const header = req.header('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  fn(req, res).catch((e) => res.status(400).json({ error: (e as Error).message ?? 'auth error' }));
};

/**
 * SIWE auth surface, mounted under /auth:
 *   POST /auth/nonce   → { nonce }               issue a one-time nonce to embed in the SIWE message
 *   POST /auth/verify  → { token, address, exp } submit { message, signature }; proves control
 *   GET  /auth/session → { address } | 401       validate the bearer token
 *   POST /auth/logout  → { ok }                  destroy the current session
 */
export function mountAuthRoutes(app: Express): void {
  app.post('/auth/nonce', wrap(async (_req, res) => {
    const nonce = generateNonce(); // 17-char alphanumeric, EIP-4361 compliant
    await issueNonce(nonce);
    res.json({ nonce });
  }));

  app.post('/auth/verify', wrap(async (req, res) => {
    const message = String(req.body?.message ?? '');
    const signature = String(req.body?.signature ?? '');
    if (!message || !signature) throw new Error('message and signature required');

    const { address } = await verifySiwe(message, signature);
    const session = await createSession(address, clientIp(req));
    res.json({ token: session.token, address: session.address, expiresAt: session.expiresAt });
  }));

  app.get('/auth/session', wrap(async (req, res) => {
    const session = await resolveSession(bearer(req), clientIp(req));
    if (!session) return void res.status(401).json({ error: 'unauthorized' });
    res.json({ address: session.address });
  }));

  app.post('/auth/logout', wrap(async (req, res) => {
    await destroySession(bearer(req));
    res.json({ ok: true });
  }));
}
