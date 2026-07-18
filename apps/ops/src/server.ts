import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { requireAdmin, handleLogin } from './auth.js';
import { listFlags, setFlag, indexerCursor, setIndexerCursor, recordAudit, listAudit } from './db.js';
import { snapshot } from './monitor.js';
import { listMarkets, marketDetail, activity, metrics, listDisputes, jurorRoster } from './queries.js';
import { alerts } from './alerts.js';
import { tailLog, logApps } from './logs.js';
import {
  seatJuror,
  setModeAStake,
  setAttester,
  setDisputeConfig,
  setAgentOracle,
  setAttributionCeiling,
  OnchainError,
} from './onchain.js';

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
  app.set('trust proxy', 1); // behind Caddy/Cloudflare — use the forwarded client IP for rate limiting
  app.use(cors());
  app.use(express.json());

  // ── Public reads ───────────────────────────────────────────────────────────
  // Liveness, no auth.
  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'echo-ops' }));

  // Authenticator login: a valid 6-digit code → short-lived session token.
  app.post('/api/login', handleLogin);

  // Feature flags as a simple { key: enabled } map — apps/web / indexer poll this. No auth so the
  // public app can read it; only the dashboard (admin) can flip them.
  app.get('/api/flags/public', h(async (_req, res) => {
    const flags = await listFlags();
    res.json(Object.fromEntries(flags.map((f) => [f.key, f.enabled])));
  }));

  // ── Admin reads ──────────────────────────────────────────────────────────────
  app.get('/api/status', requireAdmin, h(async (_req, res) => res.json(await snapshot())));
  app.get('/api/flags', requireAdmin, h(async (_req, res) => res.json(await listFlags())));
  app.get('/api/metrics', requireAdmin, h(async (_req, res) => res.json(await metrics())));
  app.get('/api/alerts', requireAdmin, h(async (_req, res) => res.json(await alerts())));
  app.get('/api/audit', requireAdmin, h(async (req, res) => res.json(await listAudit(Number(req.query.limit) || 100))));

  // Live log tail from the shared `echo_logs` volume (each app tees console → file, see logfile.ts).
  // ?app=indexer|ops, ?lines=200. The dashboard polls this for a follow-mode view.
  app.get('/api/logs', requireAdmin, h(async (req, res) =>
    res.json(tailLog(String(req.query.app || 'indexer'), Number(req.query.lines) || 200))));
  app.get('/api/logs/apps', requireAdmin, h(async (_req, res) => res.json(logApps())));

  app.get('/api/markets', requireAdmin, h(async (req, res) => {
    const q = req.query;
    res.json(
      await listMarkets({
        status: q.status ? String(q.status) : undefined,
        mode: q.mode !== undefined ? Number(q.mode) : undefined,
        q: q.q ? String(q.q) : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      }),
    );
  }));

  app.get('/api/markets/:id', requireAdmin, h(async (req, res) => {
    const detail = await marketDetail(Number(req.params.id));
    if (!detail) return void res.status(404).json({ error: 'market not found' });
    res.json(detail);
  }));

  app.get('/api/disputes', requireAdmin, h(async (req, res) => {
    const status = req.query.status !== undefined ? Number(req.query.status) : undefined;
    res.json(await listDisputes({ status, limit: req.query.limit ? Number(req.query.limit) : undefined }));
  }));

  app.get('/api/jurors', requireAdmin, h(async (_req, res) => res.json(await jurorRoster())));

  app.get('/api/activity', requireAdmin, h(async (req, res) => {
    const q = req.query;
    res.json(
      await activity({
        event: q.event ? String(q.event) : undefined,
        marketId: q.market !== undefined ? Number(q.market) : undefined,
        actor: q.actor ? String(q.actor) : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
      }),
    );
  }));

  // ── Admin: off-chain feature flags ─────────────────────────────────────────
  app.post('/api/flags/:key', requireAdmin, h(async (req, res) => {
    const { key } = req.params;
    const enabled = Boolean(req.body?.enabled);
    const row = await setFlag(key, enabled, 'dashboard');
    if (!row) return void res.status(404).json({ error: `unknown flag: ${key}` });
    await recordAudit('flag.set', { key, enabled });
    res.json(row);
  }));

  // ── Admin: indexer controls ────────────────────────────────────────────────
  // Re-index from a block by rewinding the cursor; the running ingest loop catches up next poll.
  app.post('/api/indexer/reindex', requireAdmin, h(async (req, res) => {
    const block = Number(req.body?.block);
    if (!Number.isInteger(block) || block < 0) return void res.status(400).json({ error: 'block must be a non-negative integer' });
    await setIndexerCursor(block);
    await recordAudit('indexer.reindex', { block });
    res.json({ ok: true, cursor: await indexerCursor() });
  }));

  // ── Admin: owner-only on-chain actions ─────────────────────────────────────
  app.post('/api/onchain/juror', requireAdmin, h(async (req, res) => {
    const address = String(req.body?.address ?? '');
    const active = Boolean(req.body?.active);
    const tx = await seatJuror(address, active);
    await recordAudit('onchain.juror', { address, active }, { tx });
    res.json({ ok: true, tx });
  }));

  app.post('/api/onchain/mode-a-stake', requireAdmin, h(async (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    const tx = await setModeAStake(enabled);
    await recordAudit('onchain.modeAStake', { enabled }, { tx });
    res.json({ ok: true, tx });
  }));

  app.post('/api/onchain/attester', requireAdmin, h(async (req, res) => {
    const address = String(req.body?.address ?? '');
    const allowed = Boolean(req.body?.allowed);
    const tx = await setAttester(address, allowed);
    await recordAudit('onchain.attester', { address, allowed }, { tx });
    res.json({ ok: true, tx });
  }));

  app.post('/api/onchain/dispute-config', requireAdmin, h(async (req, res) => {
    const minBond = BigInt(String(req.body?.minBond ?? '0'));
    const votingPeriod = BigInt(String(req.body?.votingPeriod ?? '0'));
    const tx = await setDisputeConfig(minBond, votingPeriod);
    await recordAudit('onchain.disputeConfig', { minBond: minBond.toString(), votingPeriod: votingPeriod.toString() }, { tx });
    res.json({ ok: true, tx });
  }));

  app.post('/api/onchain/agent-oracle', requireAdmin, h(async (req, res) => {
    const address = String(req.body?.address ?? '');
    const tx = await setAgentOracle(address);
    await recordAudit('onchain.agentOracle', { address }, { tx });
    res.json({ ok: true, tx });
  }));

  app.post('/api/onchain/ceiling', requireAdmin, h(async (req, res) => {
    const ceilingBps = Number(req.body?.ceilingBps);
    const tx = await setAttributionCeiling(ceilingBps);
    await recordAudit('onchain.ceiling', { ceilingBps }, { tx });
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
