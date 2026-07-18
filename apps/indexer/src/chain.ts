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
