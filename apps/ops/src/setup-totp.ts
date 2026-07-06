import { generateSecret, otpauthUri } from './totp.js';

// One-time enrollment helper: `pnpm --filter @echo/ops totp:setup`
// Generates a secret, prints the .env line + an otpauth URI to enroll in an authenticator app.
const secret = generateSecret();
const uri = otpauthUri(secret, 'admin', 'Echo Ops');

console.log('\n=== Echo Ops — authenticator (TOTP) setup ===\n');
console.log('1) Add this line to apps/ops/.env (keep it secret, never commit):\n');
console.log(`   OPS_TOTP_SECRET=${secret}\n`);
console.log('2) Enroll in your authenticator app (Google Authenticator, Authy, 1Password, …):');
console.log('   • Scan a QR of the URI below, OR pick "enter a setup key" and paste the secret.\n');
console.log(`   ${uri}\n`);
console.log('   Account: admin   Issuer: Echo Ops   (time-based · 6 digits · 30s)\n');
console.log('   To render a scannable QR in your terminal (if qrencode is installed):');
console.log(`   qrencode -t ANSIUTF8 "${uri}"\n`);
console.log('3) Restart the ops server. The dashboard now asks for the rotating 6-digit code.\n');
