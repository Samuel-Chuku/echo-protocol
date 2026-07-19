import { formatUnits } from 'viem';
import { config } from './config.js';
import { publicClient, ownerAccount } from './chain.js';
import { sql, indexerCursor } from './db.js';

export type AlertLevel = 'ok' | 'warn' | 'critical';
export interface Alert {
  level: AlertLevel;
  title: string;
  detail: string;
}

// Thresholds — tune as the protocol grows.
// Lag is measured in TIME, not blocks: Arc mints blocks so fast that a healthy, caught-up indexer
// is always a few hundred blocks behind yet only seconds stale. Block-count thresholds cried wolf.
const LAG_WARN_SECS = 60; // data older than this = worth a yellow flag
const LAG_STALL_SECS = 300; // older than this AND not advancing = a real (red) stall
const BALANCE_WARN_USDC = 1; // deployer gas (USDC) running low
const BALANCE_CRIT_USDC = 0.2;
const DISPUTE_STALE_SECS = 24 * 3600; // open dispute with no resolution
const GHOST_SOON_SECS = 3600; // ghost deadline within the hour

// Cross-request memory of the last cursor, so we can tell "backfilling (advancing)" from "stalled".
let lastCursorSample: number | null = null;

function humanDuration(s: number): string {
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 172800) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/** Compute the operator health signals shown as the Overview alert banner. */
export async function alerts(): Promise<Alert[]> {
  // Same reasoning as the snapshot cache (monitor.ts): up to 3 RPC calls per build, polled every
  // 6s by an open dashboard — cache so watching the dashboard doesn't eat the indexer's RPC quota.
  if (alertsCache && Date.now() - alertsCache.at < 25_000) return alertsCache.data;
  const data = await buildAlerts();
  alertsCache = { at: Date.now(), data };
  return data;
}
let alertsCache: { at: number; data: Alert[] } | null = null;

async function buildAlerts(): Promise<Alert[]> {
  const out: Alert[] = [];
  const now = Math.floor(Date.now() / 1000);

  // Chain reachable + indexer lag
  let head: number | null = null;
  try {
    head = Number(await publicClient.getBlockNumber());
  } catch {
    out.push({ level: 'critical', title: 'RPC unreachable', detail: config.rpcUrl });
  }
  const cursor = await indexerCursor();
  if (cursor == null) {
    out.push({ level: 'warn', title: 'Indexer not started', detail: 'no cursor row yet' });
  } else if (head != null) {
    const blockLag = head - cursor;
    // Time lag = how stale our newest ingested block is. Falls back to block count if the timestamp
    // read fails.
    let timeLag: number | null = null;
    try {
      const blk = await publicClient.getBlock({ blockNumber: BigInt(cursor) });
      timeLag = Math.max(0, now - Number(blk.timestamp));
    } catch {
      /* fall through to the block-count fallback below */
    }
    // Advancing since the last check? First sample assumes yes, so a fresh backfill isn't cried as a stall.
    const advancing = lastCursorSample === null ? true : cursor > lastCursorSample;
    lastCursorSample = cursor;

    if (timeLag != null) {
      if (timeLag > LAG_STALL_SECS) {
        out.push(
          advancing
            ? { level: 'warn', title: 'Indexer catching up', detail: `${humanDuration(timeLag)} behind, backfilling (${blockLag.toLocaleString()} blocks)` }
            : { level: 'critical', title: 'Indexer stalled', detail: `${humanDuration(timeLag)} behind and not advancing` },
        );
      } else if (timeLag > LAG_WARN_SECS) {
        out.push({ level: 'warn', title: 'Indexer lagging', detail: `${humanDuration(timeLag)} behind` });
      }
    } else if (blockLag > 50_000) {
      out.push({ level: 'warn', title: 'Indexer lagging', detail: `${blockLag.toLocaleString()} blocks behind` });
    }
  }

  // Deployer gas balance (only meaningful when a key is loaded)
  if (ownerAccount) {
    try {
      const bal = Number(formatUnits(await publicClient.getBalance({ address: ownerAccount.address }), 6));
      if (bal <= BALANCE_CRIT_USDC) out.push({ level: 'critical', title: 'Deployer almost out of gas', detail: `${bal.toFixed(4)} USDC` });
      else if (bal <= BALANCE_WARN_USDC) out.push({ level: 'warn', title: 'Deployer gas low', detail: `${bal.toFixed(2)} USDC` });
    } catch {
      /* balance read failed — RPC alert already covers it */
    }
  }

  // Stale open disputes (status 0 = open, 1 = countered)
  try {
    const [row] = await sql<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM disputes WHERE status = 0 AND created_at < ${now - DISPUTE_STALE_SECS}
    `;
    if (Number(row?.n ?? 0) > 0) out.push({ level: 'warn', title: 'Stale disputes', detail: `${row.n} open >24h — may need a juror` });
  } catch {
    /* disputes table may be empty/missing */
  }

  // Ghost deadlines approaching for active markets
  try {
    const [row] = await sql<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM markets
      WHERE status = 'active' AND ghost_deadline IS NOT NULL
        AND ghost_deadline > ${now} AND ghost_deadline < ${now + GHOST_SOON_SECS}
    `;
    if (Number(row?.n ?? 0) > 0) out.push({ level: 'warn', title: 'Ghost deadlines soon', detail: `${row.n} market(s) within the hour` });
  } catch {
    /* markets table may be empty */
  }

  // Arc RPC pool health (from the indexer's per-endpoint probes). All-down is critical — every
  // chain read in the web app AND the indexer is failing; partial outage is a heads-up.
  try {
    const res = await fetch(config.indexerGraphqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ health { rpcEndpoints { url ok error } } }' }),
      signal: AbortSignal.timeout(2500),
    });
    const body = await res.json().catch(() => null) as { data?: { health?: { rpcEndpoints?: Array<{ url: string; ok: boolean; error: string | null }> } } } | null;
    const pool = body?.data?.health?.rpcEndpoints ?? [];
    const down = pool.filter((p) => !p.ok);
    if (pool.length > 0 && down.length === pool.length) {
      out.push({ level: 'critical', title: 'All Arc RPC endpoints down', detail: down.map((p) => p.error).filter(Boolean).slice(0, 2).join('; ') || 'every provider failing probes' });
    } else if (down.length > 0) {
      out.push({ level: 'warn', title: `${down.length}/${pool.length} Arc RPC endpoint(s) down`, detail: down.map((p) => new URL(p.url).hostname).join(', ') });
    }
  } catch {
    /* older indexer image without probes — skip */
  }

  if (out.length === 0) out.push({ level: 'ok', title: 'All clear', detail: 'no active alerts' });
  return out;
}
