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
