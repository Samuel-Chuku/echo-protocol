import { createPublicClient, fallback, http, type Chain } from 'viem';
import { arcTestnet } from '@echo/sdk';
import { config } from './config';

/**
 * Arc testnet runs FOUR public RPC endpoints (docs.arc.io → connect-to-arc), each operated and
 * rate-limited independently: the primary, Blockdaemon, dRPC, and QuickNode. In July 2026 the
 * primary blacklisted this VPS's IP for eth_getLogs (aftermath of a multi-day retry storm) while
 * the other three served the exact same queries fine — a single-provider dependency stalled
 * ingestion for days. So: a viem fallback transport across all of them. A request that fails on
 * one provider (including rate-limits) automatically retries on the next.
 *
 * RPC_URL (config.rpcUrl) stays first so a dedicated/keyed endpoint can be dropped in via env and
 * the public pool becomes its fallback. Override the whole list with comma-separated RPC_URLS.
 */
const FALLBACK_URLS = [
  'https://rpc.drpc.testnet.arc.network',
  'https://rpc.quicknode.testnet.arc.network',
  'https://rpc.blockdaemon.testnet.arc.network',
];
const urls = process.env.RPC_URLS
  ? process.env.RPC_URLS.split(',').map((u) => u.trim()).filter(Boolean)
  : [config.rpcUrl, ...FALLBACK_URLS.filter((u) => u !== config.rpcUrl)];

export const publicClient = createPublicClient({
  chain: arcTestnet as unknown as Chain,
  transport: fallback(urls.map((u) => http(u))),
});

// ── Per-endpoint health probes (ops visibility) ──────────────────────────────
// The fallback transport hides WHICH provider is failing; when users report "network busy" the ops
// dashboard needs to see the pool's real state. A light eth_blockNumber probe per endpoint every
// 60s — 4 tiny requests/min total, negligible against any provider quota.

export type RpcProbe = { url: string; ok: boolean; latencyMs: number | null; block: number | null; error: string | null; checkedAt: number };
const probes = new Map<string, RpcProbe>(
  urls.map((u) => [u, { url: u, ok: false, latencyMs: null, block: null, error: 'not probed yet', checkedAt: 0 }]),
);

async function probeOne(url: string): Promise<void> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: AbortSignal.timeout(5_000),
    });
    const j = await res.json() as { result?: string; error?: { message?: string } };
    if (!res.ok || !j.result) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
    probes.set(url, { url, ok: true, latencyMs: Date.now() - started, block: parseInt(j.result, 16), error: null, checkedAt: Math.floor(Date.now() / 1000) });
  } catch (e) {
    probes.set(url, { url, ok: false, latencyMs: null, block: null, error: (e as Error).message ?? 'probe failed', checkedAt: Math.floor(Date.now() / 1000) });
  }
}

/** Latest probe result per configured endpoint (probed every 60s; kicked once at startup). */
export function rpcProbes(): RpcProbe[] { return [...probes.values()]; }

function probeAll(): void { for (const u of urls) void probeOne(u); }
probeAll();
setInterval(probeAll, 60_000).unref();
