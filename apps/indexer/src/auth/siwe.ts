import { SiweMessage } from 'siwe';
import { getAddress, type Hex } from 'viem';
import { publicClient } from '../chain.js';
import { config } from '../config.js';
import { consumeNonce } from './session.js';

export interface VerifyResult {
  address: string; // checksummed, proven controller
}

/**
 * Verify a SIWE (EIP-4361) sign-in.
 *
 * We parse + validate the message fields ourselves, then verify the signature with viem's
 * `verifyMessage` rather than siwe's own `.verify()` — because viem transparently handles BOTH:
 *   • EOAs (ECDSA recover), and
 *   • smart-contract wallets via EIP-1271 (`isValidSignature`), which is how Circle passkey wallets
 *     sign. siwe v3's verify path is ethers-based and needs a separate provider; going through the
 *     viem client we already have keeps one code path for both wallet kinds.
 *
 * Throws on any failure (bad nonce, wrong chain, domain mismatch, expired, bad signature).
 */
export async function verifySiwe(message: string, signature: string): Promise<VerifyResult> {
  let parsed: SiweMessage;
  try {
    parsed = new SiweMessage(message); // ABNF-parses + throws on malformed
  } catch {
    throw new Error('malformed SIWE message');
  }

  // Chain must be Arc — a signature scoped to another chain must not authenticate here.
  if (parsed.chainId !== config.chainId) {
    throw new Error(`wrong chainId: expected ${config.chainId}, got ${parsed.chainId}`);
  }

  // Domain binding — reject a signature minted for a different site (prod only; empty = testnet).
  if (config.siweDomain && parsed.domain !== config.siweDomain) {
    throw new Error(`domain mismatch: expected ${config.siweDomain}, got ${parsed.domain}`);
  }

  // Expiry / not-before windows, if the client set them.
  const nowMs = Date.now();
  if (parsed.expirationTime && nowMs >= Date.parse(parsed.expirationTime)) {
    throw new Error('SIWE message expired');
  }
  if (parsed.notBefore && nowMs < Date.parse(parsed.notBefore)) {
    throw new Error('SIWE message not yet valid');
  }

  // One-time nonce: must exist server-side AND be fresh. Consumed here so the same signature can't
  // be replayed. Do this BEFORE the (slower) signature check so a replayed nonce fails fast.
  const nonceOk = await consumeNonce(parsed.nonce);
  if (!nonceOk) throw new Error('invalid or expired nonce');

  // Signature check — EOA or EIP-1271 smart account, decided by viem based on the address' code.
  // Verify against the ORIGINAL message bytes the user signed (not a re-serialized copy) so any
  // harmless formatting difference between client and server serializers can't break a valid login.
  const address = getAddress(parsed.address); // EIP-55 checksum or throws
  const valid = await publicClient.verifyMessage({
    address,
    message,
    signature: signature as Hex,
  });
  if (!valid) throw new Error('signature does not match address');

  return { address };
}
