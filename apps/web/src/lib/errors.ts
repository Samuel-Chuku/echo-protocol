import { BaseError, ContractFunctionRevertedError } from 'viem';

/**
 * Turn a thrown write error into a human string that includes the *decoded* contract revert.
 *
 * viem's `shortMessage` for a custom error is just "The contract function … reverted." — the actual
 * error name (e.g. `InsufficientEscrow`, `NotAgentOwner`, `ValidationFailed`) lives on a nested
 * `ContractFunctionRevertedError` in the cause chain. We walk to it and surface `errorName(args)` so
 * the console shows *why* a tx reverted instead of a generic message. The MarketRegistry/EchoHook
 * ABIs carry all custom errors, so this resolves for any Echo revert; ERC-20 reverts (e.g. a missing
 * USDC allowance) fall through to their `reason`/`shortMessage`.
 */
export function formatTxError(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((err) => err instanceof ContractFunctionRevertedError) as
      | ContractFunctionRevertedError
      | null;
    if (revert) {
      const name = revert.data?.errorName ?? revert.reason;
      const args = revert.data?.args;
      if (name) {
        const argStr = args && args.length ? `(${args.map(String).join(', ')})` : '';
        return `${name}${argStr}`;
      }
    }

    // No decodable contract revert. This is the common shape for smart-account / ERC-4337 userOp
    // failures (Circle modular wallet): viem's top-level shortMessage is the generic "An unknown
    // error occurred…". The real reason lives deeper — walk to the root cause and prefer its
    // shortMessage/details/metaMessages over the generic top-level one.
    const root = e.walk() as BaseError;
    const deepest =
      (root instanceof BaseError ? root.shortMessage : undefined) ||
      (root as { details?: string }).details ||
      root.message;
    const meta = e.metaMessages?.length ? ` — ${e.metaMessages.join(' ')}` : '';
    const generic = /unknown error/i.test(e.shortMessage);
    const base = generic && deepest && deepest !== e.shortMessage ? deepest : e.shortMessage || e.message;
    return `${base}${meta}`.trim();
  }
  const err = e as { shortMessage?: string; details?: string; message?: string };
  return err.shortMessage || err.details || err.message || String(e);
}

// ─────────────────────────────── human layer ───────────────────────────────

/** Friendly one-liners for Echo's contract custom errors. Anything not listed falls through to a
 *  generic "the contract said no" phrasing that still names the error for debugging. */
const REVERT_COPY: Record<string, string> = {
  NotAgentOwner: 'This wallet doesn’t own the identity it’s acting for. Register your identity (banner on the page) and try again.',
  NotRequester: 'Only the market’s requester can do this.',
  NotParticipant: 'This wallet hasn’t applied to this market.',
  InsufficientEscrow: 'The market’s escrow can’t cover this — the escrow amount is too low.',
  AlreadyApplied: 'You’ve already applied to this market.',
  MarketClosed: 'This market has already been closed.',
  MarketFull: 'This market has reached its applicant limit.',
  GhostDeadlineNotPassed: 'The ghost deadline hasn’t passed yet — this can only run after it elapses.',
  FlagWindowNotElapsed: 'The stake is still inside its flag window — try again once the window elapses.',
  RevisionAlreadyUsed: 'A revision was already requested for this job — each job gets one.',
  TransferFailed: 'The USDC transfer failed — check your balance.',
};

/**
 * Turn ANY failure — wallet rejection, RPC outage, contract revert, server error — into one calm,
 * human sentence. This is what users see; raw shortMessages/stack-shaped strings must never reach
 * the UI (user feedback 2026-07-19). Keep the decoded detail out or, when genuinely useful for a
 * bug report, parenthesized at the end.
 */
export function humanizeError(e: unknown): string {
  const raw = formatTxError(e);
  const r = raw.toLowerCase();

  // The user closed / declined the wallet prompt — not an error, just say what happened.
  if (r.includes('user rejected') || r.includes('user denied') || r.includes('rejected the request') || r.includes('user cancelled') || r.includes('user canceled'))
    return 'You declined the request in your wallet — nothing was sent.';

  // Network/RPC trouble (the Arc public endpoints rate-limit; this must read as transient).
  if (r.includes('rpc request failed') || r.includes('http request failed') || r.includes('failed to fetch') ||
      r.includes('fetch failed') || r.includes('request limit') || r.includes('rate limit') ||
      r.includes('timeout') || r.includes('timed out') || r.includes('econnrefused') || r.includes('network error'))
    return 'The Arc network is busy or unreachable right now. Please try again in a moment.';

  // Money problems.
  if (r.includes('insufficient funds') || r.includes('exceeds the balance') || r.includes('transfer amount exceeds balance'))
    return 'Not enough USDC in the wallet to cover this.';
  if (r.includes('insufficient allowance') || r.includes('erc20: insufficient'))
    return 'The USDC approval didn’t cover this amount — retry and approve again.';

  // Wrong chain.
  if (r.includes('chain mismatch') || r.includes('does not match the target chain') || r.includes('unsupported chain'))
    return 'Your wallet is on the wrong network — switch to Arc Testnet and retry.';

  // Sign-in / session issues (agent REST surface).
  if (r.includes('sign in first') || r.includes('siwe') || r.includes('session'))
    return 'Your sign-in session has expired — sign in again (avatar menu, top right) and retry.';

  // A decoded contract revert: formatTxError returns `Name(args)`. Map known names to plain copy.
  const m = raw.match(/^([A-Z][A-Za-z0-9]*)(\(.*\))?$/);
  if (m) {
    const friendly = REVERT_COPY[m[1]];
    if (friendly) return friendly;
    return `The contract rejected this action (${m[1].replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}).`;
  }

  // Unknown: keep it short, never dump a multi-line raw error at the user.
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine.length > 140 ? `${oneLine.slice(0, 140)}…` : oneLine;
}
