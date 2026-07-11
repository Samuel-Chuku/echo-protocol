import 'dotenv/config';
import { config } from '../config.js';

/**
 * Non-destructive Circle credentials check. Inits the Developer-Controlled-Wallets client with your
 * CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET and lists wallets. Success ⇒ the key is valid AND the entity
 * secret is registered under it (you're ready). An entity-secret error ⇒ you need to register it once.
 *
 *   pnpm --filter @echo/indexer circle-check
 */
async function main(): Promise<void> {
  if (!config.circleApiKey) throw new Error('CIRCLE_API_KEY not set in apps/indexer/.env');
  if (!config.circleEntitySecret) throw new Error('CIRCLE_ENTITY_SECRET not set in apps/indexer/.env');

  const pkg = '@circle-fin/developer-controlled-wallets';
  const m: any = await import(/* @vite-ignore */ pkg).catch(() => {
    throw new Error(`Circle SDK not installed — run \`pnpm install\` first (${pkg}).`);
  });

  const client = m.initiateDeveloperControlledWalletsClient({
    apiKey: config.circleApiKey,
    entitySecret: config.circleEntitySecret,
  });

  console.log('→ Checking Circle credentials (listWallets)…');
  const res = await client.listWallets({ blockchain: 'ARC-TESTNET' });
  const wallets = res.data?.wallets ?? [];
  console.log('✅ Credentials valid and entity secret is registered.');
  console.log(`   ARC-TESTNET wallets on this entity: ${wallets.length}`);
  for (const w of wallets.slice(0, 10)) {
    console.log(`   - ${w.address}  (id ${w.id})`);
  }
  if (config.circleWalletSetId) console.log(`   CIRCLE_WALLET_SET_ID=${config.circleWalletSetId}`);
}

main().catch((e) => {
  const msg = (e as Error).message || String(e);
  console.error('❌ Circle check failed:', msg);
  if (/entity secret/i.test(msg) || /ciphertext/i.test(msg) || /not registered/i.test(msg)) {
    console.error('   → Your entity secret is not registered under this API key. Register it once:');
    console.error('     • Circle Console → Configurator → register the entity secret, OR');
    console.error('     • call registerEntitySecretCiphertext({ apiKey, entitySecret }) once (saves a recovery file).');
  } else if (/401|403|unauthor/i.test(msg)) {
    console.error('   → API key looks invalid or lacks Developer-Controlled-Wallets access.');
  }
  process.exit(1);
});
