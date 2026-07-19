'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Loader2, CheckCircle2, XCircle, ExternalLink, Copy, Check, Wallet } from 'lucide-react';
import { isTxHash, txLink, short } from './format';
import { humanizeError } from './errors';
import { bumpBalances } from './balances';

/**
 * Global transaction status. Every Echo write (approve / create / apply / join / deliver / dispute …)
 * funnels through `run`, which drives a single centered overlay: a "sign in your wallet" pulse while
 * the wallet is open, then a success receipt (with an Arcscan tx link for real actions) or the decoded
 * revert on failure. Multi-step flows pass `step`/`total` so the overlay reads "Step 2 of 2".
 *
 * `kind: 'approval'` steps are de-emphasized — they auto-dismiss and don't show a tx link (the user
 * asked to skip approval receipts); `kind: 'action'` steps show the link and stay until dismissed.
 */
export type TxKind = 'approval' | 'action';
type Meta = { title: string; kind?: TxKind; step?: number; total?: number };
type TxState = Meta & { status: 'signing' | 'success' | 'error'; kind: TxKind; hash?: string; error?: string };

interface TxCtx {
  run: <T>(meta: Meta, fn: () => Promise<T>) => Promise<T>;
}

const Ctx = createContext<TxCtx>({ run: async (_m, fn) => fn() });
export const useTx = () => useContext(Ctx);

export function TxProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TxState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setState(null);
  }, []);

  const run = useCallback<TxCtx['run']>(async (meta, fn) => {
    if (timer.current) clearTimeout(timer.current);
    const kind: TxKind = meta.kind ?? 'action';
    setState({ ...meta, kind, status: 'signing' });
    try {
      const r = await fn();
      const hash = isTxHash(r) ? (r as string) : undefined;
      setState({ ...meta, kind, status: 'success', hash });
      bumpBalances(); // every completed tx refreshes all mounted USDC balances immediately
      // Approvals are a means to an end — clear them quickly so the next step is unobstructed. Real
      // actions stay so the user can grab the tx link.
      if (kind === 'approval') timer.current = setTimeout(() => setState(null), 1400);
      return r;
    } catch (e) {
      setState({ ...meta, kind, status: 'error', error: humanizeError(e) });
      throw e;
    }
  }, []);

  return (
    <Ctx.Provider value={{ run }}>
      {children}
      {state && <TxOverlay state={state} onClose={close} />}
    </Ctx.Provider>
  );
}

function TxOverlay({ state, onClose }: { state: TxState; onClose: () => void }) {
  const stepLabel = state.step && state.total ? `Step ${state.step} of ${state.total}` : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={state.status === 'signing' ? undefined : onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0d2d4a] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {state.status === 'signing' && <Signing title={state.title} stepLabel={stepLabel} kind={state.kind} />}
        {state.status === 'success' && <Success state={state} stepLabel={stepLabel} onClose={onClose} />}
        {state.status === 'error' && <Failure state={state} onClose={onClose} />}
      </div>
    </div>
  );
}

function Signing({ title, stepLabel, kind }: { title: string; stepLabel: string | null; kind: TxKind }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative mb-4 flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-teal-400/20" />
        <span className="absolute inset-0 rounded-full bg-teal-500/10" />
        <Wallet className="relative h-7 w-7 text-teal-400" />
      </div>
      <h3 className="text-base font-semibold text-white">
        {kind === 'approval' ? 'Approve in your wallet' : 'Sign transaction'}
      </h3>
      <p className="mt-1 text-sm text-white/50">{title}</p>
      <div className="mt-3 flex items-center gap-1.5 text-xs text-white/40">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Waiting for confirmation…{stepLabel ? ` · ${stepLabel}` : ''}
      </div>
    </div>
  );
}

function Success({ state, stepLabel, onClose }: { state: TxState; stepLabel: string | null; onClose: () => void }) {
  const showLink = state.kind === 'action' && state.hash;
  return (
    <div className="flex flex-col items-center text-center">
      <CheckCircle2 className="mb-3 h-12 w-12 text-success" />
      <h3 className="text-base font-semibold text-white">
        {state.kind === 'approval' ? 'Approved' : 'Transaction successful'}
      </h3>
      <p className="mt-1 text-sm text-white/50">{state.title}{stepLabel ? ` · ${stepLabel}` : ''}</p>

      {showLink && (
        <div className="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <TxRow hash={state.hash!} />
        </div>
      )}

      <button
        onClick={onClose}
        className="mt-5 w-full rounded-md bg-teal-500 px-3 py-2 text-sm font-semibold text-ink hover:bg-teal-400 transition"
      >
        Done
      </button>
    </div>
  );
}

function Failure({ state, onClose }: { state: TxState; onClose: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      <XCircle className="mb-3 h-12 w-12 text-danger" />
      <h3 className="text-base font-semibold text-white">Transaction failed</h3>
      <p className="mt-1 text-sm text-white/50">{state.title}</p>
      <p className="mt-3 w-full break-words rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">{state.error}</p>
      <button
        onClick={onClose}
        className="mt-5 w-full rounded-md border border-white/15 bg-white/[0.06] px-3 py-2 text-sm font-medium text-white hover:bg-white/[0.1] transition"
      >
        Close
      </button>
    </div>
  );
}

/** A receipt row: a "Tx: 0x…↗" Arcscan link with copy — reused by the overlay and the job-page Receipt. */
export function TxRow({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 text-sm">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
      <a
        href={txLink(hash)}
        target="_blank"
        rel="noreferrer"
        title="View on Arcscan"
        className="inline-flex items-center gap-1 font-medium text-white/80 hover:underline"
      >
        Tx: <span className="font-mono text-white/50">{short(hash)}</span>
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
      <span className="flex-1" />
      <button
        onClick={() => { navigator.clipboard?.writeText(hash).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {}); }}
        title="Copy tx hash"
        className="text-white/40 hover:text-white transition"
      >
        {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}
