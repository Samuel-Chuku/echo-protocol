import 'dotenv/config';
import { CONTRACTS } from '@echo/sdk';

export const config = {
  rpcUrl: process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/echo_indexer',
  startBlock: BigInt(process.env.START_BLOCK || '46035076'), // earliest Echo deploy block on Arc
  batchSize: BigInt(process.env.BATCH_SIZE || '2000'),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || '4000'),
  port: Number(process.env.PORT || '4000'),
  contracts: CONTRACTS.arcTestnet,

  // SIWE / sessions. chainId is Arc's (5042002); the SIWE message's `chainId` field must match or
  // verification rejects. sessionTtlMin bounds how long a proven session lasts before re-signing.
  chainId: Number(process.env.ARC_CHAIN_ID || '5042002'),
  sessionTtlMin: Number(process.env.SESSION_TTL_MIN || '1440'), // 24h default
  // Domain the SIWE message must bind to (EIP-4361 `domain` + `uri`). Set to the web origin in prod
  // so a signature scoped to another site can't be replayed here. Empty = accept any (testnet only).
  siweDomain: (process.env.SIWE_DOMAIN || '').trim(),

  // Rollout switch for content-channel authz. false (default) = backward-compatible: if a proven
  // session is present it MUST match the claimed author/viewer, but an unauthenticated caller still
  // works (legacy client-claimed-address path). true = a valid SIWE session is REQUIRED for every
  // content write/read. Flip to true once the frontend sign-in flow is live for all wallets.
  requireAuth: (process.env.REQUIRE_AUTH || 'false').toLowerCase() === 'true',

  // ── Autonomous AI agent (#4) ──────────────────────────────────────────────
  // All off by default; the agent loop only runs when agentEnabled AND the Circle + OpenRouter keys
  // are present. Circle DCW signs on-chain (ARC-TESTNET); OpenRouter scores previews/guardrails with
  // whatever model you set in OPENROUTER_MODEL.
  agentEnabled: (process.env.AGENT_ENABLED || 'false').toLowerCase() === 'true',
  // Dry-run: screen + evaluate with the LLM and RECORD decisions, but skip all on-chain actions (no
  // Circle calls, no reveal/advance tx). Lets you test the brain + loop + decision UI locally with only
  // an OpenRouter key + a market with applicants — no Circle keys or funded wallet needed.
  agentDryRun: (process.env.AGENT_DRY_RUN || 'false').toLowerCase() === 'true',
  agentPollIntervalMs: Number(process.env.AGENT_POLL_INTERVAL_MS || '15000'),
  circleApiKey: (process.env.CIRCLE_API_KEY || '').trim(),
  circleEntitySecret: (process.env.CIRCLE_ENTITY_SECRET || '').trim(),
  circleWalletSetId: (process.env.CIRCLE_WALLET_SET_ID || '').trim(), // reuse one wallet set for all DCWs
  // LLM via OpenRouter (OpenAI-compatible). Pick any model slug OpenRouter supports.
  openrouterApiKey: (process.env.OPENROUTER_API_KEY || '').trim(),
  openrouterModel: (process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet').trim(),
  openrouterBaseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').trim(),
};
