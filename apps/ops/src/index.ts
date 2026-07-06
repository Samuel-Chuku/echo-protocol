import 'dotenv/config'; // load .env before any module reads process.env (e.g. @echo/sdk constants)
import { config, writesEnabled } from './config.js';
import { migrate } from './db.js';
import { startServer } from './server.js';

async function main() {
  console.log('=== Echo Ops Dashboard ===');
  console.log(
    `db=${config.databaseUrl.replace(/:[^:@]+@/, ':***@')} rpc=${config.rpcUrl} ` +
      `writes=${writesEnabled ? 'ENABLED (deployer key loaded)' : 'read-only (no key)'}`,
  );

  await migrate(); // create ops_feature_flags + seed canonical toggles (idempotent)
  await startServer();
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
