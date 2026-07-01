import 'dotenv/config'; // load .env before any module reads process.env (e.g. @echo/sdk constants)
import { CONTRACTS } from '@echo/sdk';

const pk = (process.env.DEPLOYER_PRIVATE_KEY || '').trim();

export const config = {
  port: Number(process.env.OPS_PORT || '4100'),
  host: process.env.OPS_HOST || '127.0.0.1',

  // Authenticator (TOTP) login. Generate with `pnpm --filter @echo/ops totp:setup`, enroll the QR,
  // then log in with the rotating 6-digit code. A valid code mints a session token good for
  // OPS_SESSION_TTL_MIN minutes.
  totpSecret: (process.env.OPS_TOTP_SECRET || '').trim(),
  sessionTtlMin: Number(process.env.OPS_SESSION_TTL_MIN || '60'),

  rpcUrl: process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/echo_indexer',
  indexerGraphqlUrl: process.env.INDEXER_GRAPHQL_URL || 'http://127.0.0.1:4000/graphql',

  // Normalize to the 0x-prefixed form viem expects, or undefined when running read-only.
  deployerKey: pk ? ((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`) : undefined,

  contracts: CONTRACTS.arcTestnet,
};

/** On-chain writes need a signing key; without one the dashboard is monitoring + flags only. */
export const writesEnabled = Boolean(config.deployerKey);

if (!config.totpSecret) {
  console.warn('[ops] WARNING: OPS_TOTP_SECRET is empty — admin login disabled. Run `pnpm --filter @echo/ops totp:setup`.');
}
