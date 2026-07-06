import { formatUnits } from 'viem';
import { sql } from './db.js';

// Read views over the indexer's tables for the dashboard. Ops only READS these tables; the indexer
// owns them. Amounts are USDC (6 decimals) stored as wei-strings — formatted here for display.

const MODE_LABEL = ['Open/Reveal', 'DirectJob', 'Bounty'] as const;
export const modeLabel = (m: number) => MODE_LABEL[m] ?? `mode ${m}`;

const usdc = (wei: unknown): string => {
  const s = String(wei ?? '');
  if (!/^\d+$/.test(s)) return '0';
  try {
    return formatUnits(BigInt(s), 6);
  } catch {
    return '0';
  }
};

// ── Markets list ─────────────────────────────────────────────────────────────

export interface MarketRow {
  id: number;
  mode: number;
  modeLabel: string;
  requester: string;
  worker: string | null;
  status: string;
  escrowUsdc: string;
  ghostDeadline: number | null;
  applicantCount: number;
  createdAt: number;
}

export async function listMarkets(opts: {
  status?: string;
  mode?: number;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<MarketRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  const conds = [];
  if (opts.status) conds.push(sql`status = ${opts.status}`);
  if (opts.mode !== undefined && !Number.isNaN(opts.mode)) conds.push(sql`mode = ${opts.mode}`);
  if (opts.q) {
    const q = `%${opts.q.toLowerCase()}%`;
    const asId = Number(opts.q);
    conds.push(
      Number.isInteger(asId)
        ? sql`(LOWER(requester) LIKE ${q} OR LOWER(worker) LIKE ${q} OR id = ${asId})`
        : sql`(LOWER(requester) LIKE ${q} OR LOWER(worker) LIKE ${q})`,
    );
  }
  const where = conds.length ? conds.reduce((a, b) => sql`${a} AND ${b}`) : null;

  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT id, mode, requester, worker, status, escrow_total, ghost_deadline, applicant_count, created_at
    FROM markets
    ${where ? sql`WHERE ${where}` : sql``}
    ORDER BY id DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    mode: Number(r.mode),
    modeLabel: modeLabel(Number(r.mode)),
    requester: String(r.requester),
    worker: (r.worker as string) || null,
    status: String(r.status),
    escrowUsdc: usdc(r.escrow_total),
    ghostDeadline: r.ghost_deadline != null ? Number(r.ghost_deadline) : null,
    applicantCount: Number(r.applicant_count ?? 0),
    createdAt: Number(r.created_at ?? 0),
  }));
}

// ── Market detail (drill-down) ───────────────────────────────────────────────

export async function marketDetail(id: number): Promise<Record<string, unknown> | null> {
  const [market] = await sql<Array<Record<string, unknown>>>`SELECT * FROM markets WHERE id = ${id} LIMIT 1`;
  if (!market) return null;

  const [applications, findings, milestones, contents, disputes] = await Promise.all([
    sql`SELECT participant, agent_id, tier_reached, status, submission_hash, created_at FROM applications WHERE market_id = ${id} ORDER BY created_at`,
    sql`SELECT idx, submitter, finding_hash, status, award, created_at FROM findings WHERE market_id = ${id} ORDER BY idx`,
    sql`SELECT idx, amount, status, submitted_at FROM milestones WHERE market_id = ${id} ORDER BY idx`,
    sql`SELECT kind, key, author, created_at FROM contents WHERE market_id = ${id} ORDER BY created_at`,
    sql`SELECT id, subject, status, opener, counter, bond, for_opener, against, created_at FROM disputes WHERE market_id = ${id} ORDER BY id`,
  ]);

  return {
    market: {
      ...market,
      modeLabel: modeLabel(Number(market.mode)),
      escrowUsdc: usdc(market.escrow_total),
    },
    applications,
    findings: (findings as Array<Record<string, unknown>>).map((f) => ({ ...f, awardUsdc: usdc(f.award) })),
    milestones: (milestones as Array<Record<string, unknown>>).map((m) => ({ ...m, amountUsdc: usdc(m.amount) })),
    contents,
    disputes: (disputes as Array<Record<string, unknown>>).map((d) => ({ ...d, bondUsdc: usdc(d.bond) })),
  };
}

// ── Activity feed ────────────────────────────────────────────────────────────

export interface ActivityRow {
  block: number;
  tx: string;
  logIndex: number;
  event: string;
  marketId: number | null;
  actor: string | null;
  args: Record<string, unknown>;
  ts: number;
}

export async function activity(opts: { event?: string; marketId?: number; actor?: string; limit?: number }): Promise<ActivityRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const conds = [];
  if (opts.event) conds.push(sql`event_name = ${opts.event}`);
  if (opts.marketId !== undefined && !Number.isNaN(opts.marketId)) conds.push(sql`market_id = ${opts.marketId}`);
  if (opts.actor) conds.push(sql`LOWER(actor) = ${opts.actor.toLowerCase()}`);
  const where = conds.length ? conds.reduce((a, b) => sql`${a} AND ${b}`) : null;

  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT block_number, tx_hash, log_index, event_name, market_id, actor, args, created_at
    FROM events
    ${where ? sql`WHERE ${where}` : sql``}
    ORDER BY block_number DESC, log_index DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(String(r.args ?? '{}'));
    } catch {
      /* leave empty */
    }
    return {
      block: Number(r.block_number),
      tx: String(r.tx_hash),
      logIndex: Number(r.log_index),
      event: String(r.event_name),
      marketId: r.market_id != null ? Number(r.market_id) : null,
      actor: (r.actor as string) || null,
      args,
      ts: Number(r.created_at ?? 0),
    };
  });
}

// ── Disputes console ─────────────────────────────────────────────────────────

const SUBJECT_LABEL = ['BountyFinding', 'ModeAStake', 'TierJobRejection'] as const;
const DISPUTE_STATUS = ['Open', 'Resolved'] as const;

export interface DisputeRow {
  id: number;
  subject: number;
  subjectLabel: string;
  marketId: number | null;
  target: number | null;
  status: number;
  statusLabel: string;
  opener: string | null;
  counter: string | null;
  bondUsdc: string;
  forOpener: number;
  against: number;
  countered: boolean;
  createdAt: number;
}

export async function listDisputes(opts: { status?: number; limit?: number } = {}): Promise<DisputeRow[]> {
  const limit = Math.min(opts.limit ?? 100, 300);
  const where = opts.status !== undefined && !Number.isNaN(opts.status) ? sql`WHERE status = ${opts.status}` : sql``;
  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT id, subject, market_id, target, status, opener, counter, bond, for_opener, against, created_at
    FROM disputes ${where} ORDER BY id DESC LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    subject: Number(r.subject),
    subjectLabel: SUBJECT_LABEL[Number(r.subject)] ?? `subject ${r.subject}`,
    marketId: r.market_id != null ? Number(r.market_id) : null,
    target: r.target != null ? Number(r.target) : null,
    status: Number(r.status),
    statusLabel: DISPUTE_STATUS[Number(r.status)] ?? `status ${r.status}`,
    opener: (r.opener as string) || null,
    counter: (r.counter as string) || null,
    bondUsdc: usdc(r.bond),
    forOpener: Number(r.for_opener ?? 0),
    against: Number(r.against ?? 0),
    countered: Boolean(r.counter),
    createdAt: Number(r.created_at ?? 0),
  }));
}

// ── Juror roster ─────────────────────────────────────────────────────────────
// Fold the DisputeResolver's JurorSet(juror, active) events into the current seated set. Read from
// the indexer's event log — no extra on-chain calls. Latest event per juror wins.

export async function jurorRoster(): Promise<string[]> {
  const rows = await sql<Array<{ args: string; block_number: number; log_index: number }>>`
    SELECT args, block_number, log_index FROM events
    WHERE event_name = 'JurorSet' ORDER BY block_number ASC, log_index ASC
  `;
  const state = new Map<string, boolean>();
  for (const r of rows) {
    try {
      const a = JSON.parse(r.args) as { juror?: string; active?: boolean };
      if (a.juror) state.set(String(a.juror).toLowerCase(), Boolean(a.active));
    } catch {
      /* skip malformed */
    }
  }
  return [...state.entries()].filter(([, active]) => active).map(([juror]) => juror);
}

// ── Metrics (for charts + tiles) ─────────────────────────────────────────────

export async function metrics(): Promise<Record<string, unknown>> {
  const [marketsByStatus, disputesByStatus, escrow, eventsPerDay, marketsPerDay, totals] = await Promise.all([
    sql`SELECT status, COUNT(*)::int AS n FROM markets GROUP BY status`,
    sql`SELECT status, COUNT(*)::int AS n FROM disputes GROUP BY status`,
    sql`SELECT COALESCE(SUM(CASE WHEN escrow_total ~ '^[0-9]+$' THEN escrow_total::numeric ELSE 0 END), 0) AS wei
        FROM markets WHERE status = 'active'`,
    sql`SELECT (created_at / 86400) * 86400 AS day, COUNT(*)::int AS n
        FROM events WHERE created_at > 0 GROUP BY day ORDER BY day DESC LIMIT 14`,
    sql`SELECT (created_at / 86400) * 86400 AS day, COUNT(*)::int AS n
        FROM markets WHERE created_at > 0 GROUP BY day ORDER BY day DESC LIMIT 14`,
    sql`SELECT
          (SELECT COUNT(*)::int FROM markets) AS markets,
          (SELECT COUNT(*)::int FROM events) AS events,
          (SELECT COUNT(*)::int FROM disputes) AS disputes,
          (SELECT COUNT(*)::int FROM reputation) AS participants`,
  ]);

  const escrowWei = String((escrow as unknown as Array<{ wei: string }>)[0]?.wei ?? '0').split('.')[0];
  return {
    totals: (totals as unknown as Array<Record<string, number>>)[0] ?? {},
    escrowLockedUsdc: usdc(escrowWei),
    marketsByStatus,
    disputesByStatus,
    eventsPerDay: (eventsPerDay as unknown as Array<{ day: number; n: number }>).slice().reverse(),
    marketsPerDay: (marketsPerDay as unknown as Array<{ day: number; n: number }>).slice().reverse(),
  };
}
