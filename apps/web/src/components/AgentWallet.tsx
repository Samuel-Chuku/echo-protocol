'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, ArrowDownToLine, ArrowUpFromLine, Copy, Check, Loader2 } from 'lucide-react';
import { useEcho } from '@/lib/sdk';
import { useTx } from '@/lib/tx';
import { humanizeError } from '@/lib/errors';
import { getAgentWallet, withdrawAgent } from '@/lib/agentApi';
import { useUsdcBalance, bumpBalances } from '@/lib/balances';
import { toUnits, usdc, short } from '@/lib/format';
import { Button } from '@/components/ui';

/**
 * The requester's standing agent account (#4): one persistent Circle DCW, always ready — deposit
 * USDC in, withdraw out, any time. Agent markets draw escrow straight from this balance.
 *
 * Balances are read ON-CHAIN (USDC.balanceOf via useUsdcBalance) — never Circle's monitored-token
 * API, which lags funding and caused the "deposited but shows $0" bug. Live: 5s poll + instant
 * refresh after every app transaction (bumpBalances).
 */
export function AgentWallet({ onBalance }: { onBalance?: (balanceHuman: string) => void }) {
  const { sdk, account } = useEcho();
  const { run: runTx } = useTx();
  const [wallet, setWallet] = useState<{ walletAddress: string } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'deposit' | 'withdraw' | null>(null);
  const [depositAmt, setDepositAmt] = useState('');
  const [withdrawAmt, setWithdrawAmt] = useState('');
  const [copied, setCopied] = useState(false);

  // Live on-chain balances: the agent wallet's (the number that matters) and the user's own (for
  // deposit context). Both poll every 5s and refresh instantly after any tx.
  const { balance: agentBal, refresh: refreshAgent } = useUsdcBalance(wallet?.walletAddress ?? null);
  const { balance: myBal } = useUsdcBalance(account ?? null);

  // Resolve (or lazily create) the persistent wallet once per signed-in session.
  useEffect(() => {
    let active = true;
    setLoadErr(null);
    getAgentWallet()
      .then((w) => { if (active) setWallet({ walletAddress: w.walletAddress }); })
      .catch((e) => { if (active) setLoadErr(humanizeError(e)); });
    return () => { active = false; };
  }, [account]);

  // Bubble the live balance up (the wizard validates escrow against it).
  useEffect(() => {
    if (agentBal !== null) onBalance?.(usdc(agentBal));
  }, [agentBal, onBalance]);

  // Both money moves run through the global tx overlay (useTx) so the user gets the same
  // signing → success-receipt modal every other transaction shows (user ask 2026-07-19).
  const deposit = useCallback(async () => {
    if (!wallet || !account || !depositAmt.trim()) return;
    setBusy('deposit');
    try {
      await runTx({ title: `Deposit $${depositAmt} USDC into your agent wallet` }, () =>
        sdk.transferUsdc(wallet.walletAddress as `0x${string}`, toUnits(depositAmt), account));
      setDepositAmt('');
      bumpBalances(); // on-chain read → reflects immediately, no Circle lag
    } catch { /* the overlay already showed the humanized failure */ }
    finally { setBusy(null); }
  }, [wallet, account, depositAmt, sdk, runTx]);

  const withdraw = useCallback(async () => {
    if (!withdrawAmt.trim()) return;
    setBusy('withdraw');
    try {
      // Circle signs + submits server-side (no wallet prompt) — the overlay still gives the
      // success receipt with the tx link once it lands.
      await runTx({ title: `Withdraw $${withdrawAmt} USDC to your wallet` }, async () => {
        const { txHash } = await withdrawAgent(withdrawAmt);
        return txHash;
      });
      setWithdrawAmt('');
      bumpBalances();
      setTimeout(refreshAgent, 4000); // Circle-submitted tx can land a beat later — re-read once more
    } catch { /* the overlay already showed the humanized failure */ }
    finally { setBusy(null); }
  }, [withdrawAmt, refreshAgent, runTx]);

  if (loadErr) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs text-white/50">
        <span className="inline-flex items-center gap-1.5 text-white/70 font-medium"><Bot className="w-4 h-4" /> Agent wallet</span>
        <p className="mt-1 text-danger break-all">{loadErr}</p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-teal-500/25 bg-gradient-to-br from-teal-500/[0.10] via-white/[0.02] to-transparent p-4">
      {/* header */}
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300"><Bot className="w-4.5 h-4.5" /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white leading-tight">Agent wallet</p>
          <p className="text-[11px] text-white/40 leading-tight">Always on — deposit or withdraw any time. Agent markets draw from this balance.</p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> live
        </span>
      </div>

      {/* balance */}
      <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/40">Agent balance</p>
          {agentBal === null && wallet ? (
            <Loader2 className="mt-1 w-5 h-5 animate-spin text-white/30" />
          ) : (
            <p className="text-3xl font-bold font-mono text-white leading-none mt-1">
              ${agentBal !== null ? usdc(agentBal) : '0'}<span className="ml-1.5 text-xs font-sans font-normal text-white/40">USDC</span>
            </p>
          )}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/40">Your wallet</p>
          <p className="text-sm font-mono text-white/60 mt-1">${myBal !== null ? usdc(myBal) : '—'} USDC</p>
        </div>
        {wallet && (
          <button
            onClick={() => { navigator.clipboard?.writeText(wallet.walletAddress); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-mono text-white/50 hover:text-white hover:border-white/25 transition"
            title={wallet.walletAddress}
          >
            {short(wallet.walletAddress)} {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
          </button>
        )}
      </div>

      {/* deposit / withdraw */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-white/70 inline-flex items-center gap-1"><ArrowDownToLine className="w-3.5 h-3.5 text-teal-400" /> Deposit</span>
            {myBal !== null && myBal > 0n && (
              <button onClick={() => setDepositAmt(usdc(myBal))} className="text-[10px] text-teal-400 hover:underline">max ${usdc(myBal)}</button>
            )}
          </div>
          <div className="mt-2 flex gap-1.5">
            <input
              value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} inputMode="decimal" placeholder="0.00"
              className="w-full min-w-0 rounded-md border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-sm font-mono text-white placeholder:text-white/25 focus:border-teal-500/40 focus:outline-none"
            />
            <Button variant="secondary" className="!min-h-0 !py-1.5 !px-3 shrink-0" busy={busy === 'deposit'} disabled={!account || !wallet || !depositAmt.trim()} onClick={deposit}>Add</Button>
          </div>
          <p className="mt-1.5 text-[10px] text-white/35">From your connected wallet into the agent&apos;s.</p>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-white/70 inline-flex items-center gap-1"><ArrowUpFromLine className="w-3.5 h-3.5 text-teal-400" /> Withdraw</span>
            {agentBal !== null && agentBal > 0n && (
              <button onClick={() => setWithdrawAmt(usdc(agentBal))} className="text-[10px] text-teal-400 hover:underline">max ${usdc(agentBal)}</button>
            )}
          </div>
          <div className="mt-2 flex gap-1.5">
            <input
              value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} inputMode="decimal" placeholder="0.00"
              className="w-full min-w-0 rounded-md border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-sm font-mono text-white placeholder:text-white/25 focus:border-teal-500/40 focus:outline-none"
            />
            <Button variant="secondary" className="!min-h-0 !py-1.5 !px-3 shrink-0" busy={busy === 'withdraw'} disabled={!wallet || agentBal === null || agentBal <= 0n || !withdrawAmt.trim()} onClick={withdraw}>Send</Button>
          </div>
          <p className="mt-1.5 text-[10px] text-white/35">Back to your connected wallet, any time.</p>
        </div>
      </div>

    </div>
  );
}
