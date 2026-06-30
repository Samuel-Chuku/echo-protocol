import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { requireAdmin } from './auth.js';
import { listFlags, setFlag, indexerCursor, setIndexerCursor } from './db.js';
import { snapshot } from './monitor.js';
import { seatJuror, setModeAStake, setAttester, OnchainError } from './onchain.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

// Small async wrapper so thrown errors become clean JSON instead of hanging the request.
const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  fn(req, res).catch((e) => {
    const status = e instanceof OnchainError ? e.status : 500;
    res.status(status).json({ error: (e as Error).message ?? 'internal error' });
  });
};

export function startServer(): Promise<void> {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // ── Public reads ───────────────────────────────────────────────────────────
  // Liveness, no auth.
  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'echo-ops' }));

  // Feature flags as a simple { key: enabled } map — apps/web / indexer poll this. No auth so the
  // public app can read it; only the dashboard (admin) can flip them.
  app.get('/api/flags/public', h(async (_req, res) => {
    const flags = await listFlags();
    res.json(Object.fromEntries(flags.map((f) => [f.key, f.enabled])));
  }));

  // ── Admin reads ──────────────────────────────────────────────────────────────
  app.get('/api/status', requireAdmin, h(async (_req, res) => res.json(await snapshot())));
  app.get('/api/flags', requireAdmin, h(async (_req, res) => res.json(await listFlags())));

  // ── Admin: off-chain feature flags ─────────────────────────────────────────
  app.post('/api/flags/:key', requireAdmin, h(async (req, res) => {
    const { key } = req.params;
    const enabled = Boolean(req.body?.enabled);
    const row = await setFlag(key, enabled, 'dashboard');
    if (!row) return void res.status(404).json({ error: `unknown flag: ${key}` });
    res.json(row);
  }));

  // ── Admin: indexer controls ────────────────────────────────────────────────
  // Re-index from a block by rewinding the cursor; the running ingest loop catches up next poll.
  app.post('/api/indexer/reindex', requireAdmin, h(async (req, res) => {
    const block = Number(req.body?.block);
    if (!Number.isInteger(block) || block < 0) return void res.status(400).json({ error: 'block must be a non-negative integer' });
    await setIndexerCursor(block);
    res.json({ ok: true, cursor: await indexerCursor() });
  }));

  // ── Admin: owner-only on-chain actions ─────────────────────────────────────
  app.post('/api/onchain/juror', requireAdmin, h(async (req, res) => {
    const tx = await seatJuror(String(req.body?.address ?? ''), Boolean(req.body?.active));
    res.json({ ok: true, tx });
  }));

  app.post('/api/onchain/mode-a-stake', requireAdmin, h(async (req, res) => {
    const tx = await setModeAStake(Boolean(req.body?.enabled));
    res.json({ ok: true, tx });
  }));

  app.post('/api/onchain/attester', requireAdmin, h(async (req, res) => {
    const tx = await setAttester(String(req.body?.address ?? ''), Boolean(req.body?.allowed));
    res.json({ ok: true, tx });
  }));

  // ── Dashboard UI (static) ──────────────────────────────────────────────────
  app.use(express.static(PUBLIC_DIR));

  return new Promise((resolve) => {
    app.listen(config.port, config.host, () => {
      console.log(`[ops] dashboard + API on http://${config.host}:${config.port}`);
      resolve();
    });
  });
}
