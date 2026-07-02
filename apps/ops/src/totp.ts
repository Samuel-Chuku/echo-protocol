import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// RFC 6238 (TOTP) on top of RFC 4226 (HOTP), implemented with Node's crypto so the dashboard needs
// no extra dependency. Compatible with Google Authenticator / Authy / 1Password (SHA1, 6 digits, 30s).

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648 base32 alphabet

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue; // skip stray chars
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh base32 TOTP secret (160-bit by default — the standard authenticator strength). */
export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

function hotp(secret: Buffer, counter: number, digits: number): string {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter (JS bitwise is 32-bit, so split hi/lo).
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac('sha1', secret).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}

/**
 * Verify a code against the secret. `window` accepts ±N 30s steps (default ±1) to tolerate small
 * clock skew. Constant-time compare so a wrong code leaks no timing.
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  opts: { period?: number; digits?: number; window?: number } = {},
): boolean {
  const period = opts.period ?? 30;
  const digits = opts.digits ?? 6;
  const window = opts.window ?? 1;
  const normalized = (code || '').replace(/\s/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) return false;
  const secret = base32Decode(secretB32);
  if (secret.length === 0) return false;
  const counter = Math.floor(Date.now() / 1000 / period);
  const expected = Buffer.from(normalized);
  for (let w = -window; w <= window; w++) {
    const candidate = Buffer.from(hotp(secret, counter + w, digits));
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}

/** otpauth:// URI for QR enrollment in an authenticator app. */
export function otpauthUri(secretB32: string, label = 'admin', issuer = 'Echo Ops'): string {
  const enc = encodeURIComponent;
  return (
    `otpauth://totp/${enc(issuer)}:${enc(label)}` +
    `?secret=${secretB32}&issuer=${enc(issuer)}&period=30&digits=6&algorithm=SHA1`
  );
}
