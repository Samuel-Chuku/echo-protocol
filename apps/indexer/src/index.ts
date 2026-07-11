import 'dotenv/config'; // load .env before any module reads process.env (e.g. @echo/sdk constants)
import { migrate } from './db/client.js';
import { runIngestLoop } from './indexer/ingest.js';
import { runAgentLoop } from './agent/loop.js';
import { startServer } from './server.js';
import { config } from './config.js';

async function main() {
  console.log('=== Echo Indexer ===');
  console.log(`db=${config.databaseUrl.replace(/:[^:@]+@/, ':***@')} rpc=${config.rpcUrl} startBlock=${config.startBlock}`);

  await migrate(); // create tables on first run (idempotent)

  // Serve immediately; ingest runs in the background and catches up.
  await startServer();
  runIngestLoop().catch((e) => {
    console.error('[fatal] ingest loop crashed:', e);
    process.exit(1);
  });

  // Autonomous screening agent (#4) — no-op unless AGENT_ENABLED + keys are set. A crash here must
  // NOT take down the indexer/ingest, so it's logged, not fatal.
  runAgentLoop().catch((e) => console.error('[agent] loop crashed:', e));
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
