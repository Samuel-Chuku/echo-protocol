import postgres from 'postgres';
import { config } from './config.js';

// Shared with the indexer (same DATABASE_URL). Ops OWNS `ops_feature_flags` and only READS the
// indexer's tables (cursor, disputes, events). `max: 5` is ample for a single-operator dashboard.
export const sql = postgres(config.databaseUrl, { max: 5 });

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  label: string;
  category: 'web' | 'indexer';
  updatedAt: number;
  updatedBy: string | null;
}

// Canonical flags, seeded on first boot. `web.*` are read by apps/web; `indexer.paused` is read by
// the ingest loop. Add a row here to introduce a new toggle — the UI renders whatever is in the table.
const SEED: Array<Pick<FeatureFlag, 'key' | 'label' | 'category'>> = [
  { key: 'web.maintenance', label: 'Maintenance banner on web', category: 'web' },
  { key: 'web.pauseMarketCreation', label: 'Disable “Create market” on web', category: 'web' },
  { key: 'web.hideReject', label: 'Hide Final-tier reject button', category: 'web' },
  { key: 'indexer.paused', label: 'Pause indexer ingestion', category: 'indexer' },
];

/** Idempotent: create the flags table and seed canonical rows (mirrors the indexer's in-process DDL). */
export async function migrate(): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ops_feature_flags (
      key TEXT PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      label TEXT NOT NULL,
      category TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT
    );
  `);
  for (const f of SEED) {
    await sql`
      INSERT INTO ops_feature_flags (key, label, category, enabled, updated_at)
      VALUES (${f.key}, ${f.label}, ${f.category}, FALSE, 0)
      ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, category = EXCLUDED.category
    `;
  }
  // Append-only record of every admin action taken through the dashboard (accountability).
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ops_audit_log (
      id SERIAL PRIMARY KEY,
      ts INTEGER NOT NULL,
      actor TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      tx TEXT
    );
    CREATE INDEX IF NOT EXISTS ops_audit_ts ON ops_audit_log(ts DESC);
  `);
}

// ── Audit log ────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: number;
  ts: number;
  actor: string | null;
  action: string;
  detail: string | null;
  tx: string | null;
}

export async function recordAudit(
  action: string,
  detail: Record<string, unknown>,
  meta: { actor?: string; tx?: string } = {},
): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);
  await sql`
    INSERT INTO ops_audit_log (ts, actor, action, detail, tx)
    VALUES (${ts}, ${meta.actor ?? 'admin'}, ${action}, ${JSON.stringify(detail)}, ${meta.tx ?? null})
  `;
}

export async function listAudit(limit = 100): Promise<AuditEntry[]> {
  return sql<AuditEntry[]>`
    SELECT id, ts, actor, action, detail, tx
    FROM ops_audit_log ORDER BY id DESC LIMIT ${Math.min(limit, 500)}
  `;
}

export async function listFlags(): Promise<FeatureFlag[]> {
  const rows = await sql<FeatureFlag[]>`
    SELECT key, enabled, label, category, updated_at AS "updatedAt", updated_by AS "updatedBy"
    FROM ops_feature_flags ORDER BY category, key
  `;
  return rows;
}

export async function getFlag(key: string): Promise<boolean> {
  const [row] = await sql<{ enabled: boolean }[]>`
    SELECT enabled FROM ops_feature_flags WHERE key = ${key} LIMIT 1
  `;
  return row?.enabled ?? false;
}

export async function setFlag(key: string, enabled: boolean, by: string): Promise<FeatureFlag | null> {
  const now = Math.floor(Date.now() / 1000);
  const [row] = await sql<FeatureFlag[]>`
    UPDATE ops_feature_flags
    SET enabled = ${enabled}, updated_at = ${now}, updated_by = ${by}
    WHERE key = ${key}
    RETURNING key, enabled, label, category, updated_at AS "updatedAt", updated_by AS "updatedBy"
  `;
  return row ?? null;
}

// ── Indexer-table reads (monitoring) ────────────────────────────────────────

/** The indexer's last fully-ingested block (its `cursor.head` row), or null if it never ran. */
export async function indexerCursor(): Promise<number | null> {
  try {
    const [row] = await sql<{ last_block: number }[]>`
      SELECT last_block FROM cursor WHERE id = 'head' LIMIT 1
    `;
    return row ? Number(row.last_block) : null;
  } catch {
    return null; // indexer hasn't created its tables yet
  }
}

/** Rewind the indexer cursor to force a re-index from `block`. The running loop picks it up next poll. */
export async function setIndexerCursor(block: number): Promise<void> {
  // Keep the pre-rewind cursor in a sibling row first — the dashboard shows it as "before
  // re-index" so an operator can tell how far back they jumped (and where "caught up" is).
  await sql`
    INSERT INTO cursor (id, last_block)
    SELECT 'reindex-prev', last_block FROM cursor WHERE id = 'head'
    ON CONFLICT (id) DO UPDATE SET last_block = EXCLUDED.last_block
  `;
  await sql`
    INSERT INTO cursor (id, last_block) VALUES ('head', ${block})
    ON CONFLICT (id) DO UPDATE SET last_block = ${block}
  `;
}

export async function disputeCounts(): Promise<{ total: number; open: number }> {
  try {
    const [row] = await sql<{ total: number; open: number }[]>`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 0)::int AS open
      FROM disputes
    `;
    return { total: Number(row?.total ?? 0), open: Number(row?.open ?? 0) };
  } catch {
    return { total: 0, open: 0 };
  }
}

export async function eventCount(): Promise<number> {
  try {
    const [row] = await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM events`;
    return Number(row?.count ?? 0);
  } catch {
    return 0;
  }
}
