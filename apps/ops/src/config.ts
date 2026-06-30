import 'dotenv/config'; // load .env before any module reads process.env (e.g. @echo/sdk constants)
import { CONTRACTS } from '@echo/sdk';

const pk = (process.env.DEPLOYER_PRIVATE_KEY || '').trim();

export const config = {
  port: Number(process.env.OPS_PORT || '4100'),
  host: process.env.OPS_HOST || '127.0.0.1',
  adminToken: (process.env.OPS_ADMIN_TOKEN || '').trim(),

  rpcUrl: process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/echo_indexer',
  indexerGraphqlUrl: process.env.INDEXER_GRAPHQL_URL || 'http://127.0.0.1:4000/graphql',

  // Normalize to the 0x-prefixed form viem expects, or undefined when running read-only.
  deployerKey: pk ? ((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`) : undefined,

  contracts: CONTRACTS.arcTestnet,
};

/** On-chain writes need a signing key; without one the dashboard is monitoring + flags only. */
export const writesEnabled = Boolean(config.deployerKey);

if (!config.adminToken) {
  console.warn('[ops] WARNING: OPS_ADMIN_TOKEN is empty — refusing to expose admin routes. Set it in .env.');
}
