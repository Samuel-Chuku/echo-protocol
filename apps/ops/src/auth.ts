import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';

/**
 * Bearer-token gate for every mutating/sensitive route. Compares against OPS_ADMIN_TOKEN.
 * If the token is unset we fail closed (deny all) rather than open. The compare is constant-ish —
 * tokens are long random secrets, so timing leakage is not the threat model here, but we still
 * require an exact length+value match.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!config.adminToken) {
    res.status(503).json({ error: 'admin disabled: OPS_ADMIN_TOKEN is not set on the server' });
    return;
  }
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token !== config.adminToken) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}
