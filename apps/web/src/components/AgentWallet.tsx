'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, ArrowDownToLine, ArrowUpFromLine, RefreshCw, Copy, Check } from 'lucide-react';
import { useEcho } from '@/lib/sdk';
import { getAgentWallet, withdrawAgent } from '@/lib/agentApi';
import { toUnits, usdc } from '@/lib/format';
import { CARD_CLASS, Field, Button } from '@/components/ui';

/**
 * Persistent agent-wallet account (#4). Shows the standing USDC balance of the requester's Circle DCW
 * with deposit (their wallet → DCW) and withdraw (DCW → their wallet) controls. Agent markets draw
 * escrow from this balance, so there's no per-market funding step. `onBalance` bubbles the live balance
 * up so the create-market wizard can validate escrow against it.
 */
export function AgentWallet({ onBalance }: { onBalance?: (balanceHuman: string) => void }) {
  const { sdk, account } = useEcho();
  const [wallet, setWallet] = useState<{ walletAddress: string; balance: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'deposit' | 'withdraw' | null>(null);
  const [depositAmt, setDepositAmt] = useState('');
  const [withdrawAmt, setWithdrawAmt] = useState('');
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const w = await getAgentWallet();
      setWallet({ walletAddress: w.walletAddress, balance: w.balance });
      onBalance?.(w.balance);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to load agent wallet');
    } finally { setLoading(false); }
  }, [onBalance]);

  useEffect(() => { refresh(); }, [refresh]);

  async function deposit() {
    if (!wallet || !account || !depositAmt.trim()) return;
    setBusy('deposit'); setErr(null);
    try {
      // The connected wallet signs a plain USDC transfer to the agent wallet address.
      await sdk.transferUsdc(wallet.walletAddress as `0x${string}`, toUnits(depositAmt), account);
      setDepositAmt('');
      // Circle balance lags the on-chain transfer a little; refresh after a short beat.
      setTimeout(refresh, 4000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'deposit failed');
    } finally { setBusy(null); }
  }

  async function withdraw() {
    if (!withdrawAmt.trim()) return;
    setBusy('withdraw'); setErr(null);
    try {
      await withdrawAgent(withdrawAmt);
      setWithdrawAmt('');
      setTimeout(refresh, 4000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'withdraw failed');
    } finally { setBusy(null); }
  }

  const bal = wallet ? Number(wallet.balance) : 0;

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white">
          <Bot className="w-4 h-4 text-teal-400" /> Agent wallet
        </h3>
        <button onClick={refresh} className="text-white/40 hover:text-white" title="Refresh balance">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <p className="text-xs text-white/40 mt-0.5">
        Your standing balance for AI-agent markets. Deposit USDC here, then create agent markets that draw escrow from it.
      </p>

      {err && <p className="mt-2 text-xs text-danger break-all">{err}</p>}

      {wallet && (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white font-mono">${usdc(BigInt(Math.floor(bal * 1e6)))}</span>
            <span className="text-xs text-white/40">USDC available</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-white/40">
            <span className="font-mono break-all">{wallet.walletAddress}</span>
            <button
              onClick={() => { navigator.clipboard?.writeText(wallet.walletAddress); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
              className="shrink-0 hover:text-white" title="Copy address"
            >
              {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Field label="deposit USDC (from your wallet)" value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} inputMode="decimal" placeholder="0.00" />
              <Button variant="secondary" busy={busy === 'deposit'} disabled={!account || !depositAmt.trim()} onClick={deposit}>
                <ArrowDownToLine className="w-3.5 h-3.5" /> Deposit
              </Button>
            </div>
            <div className="space-y-1.5">
              <Field label="withdraw USDC (to your wallet)" value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} inputMode="decimal" placeholder="0.00" />
              <Button variant="secondary" busy={busy === 'withdraw'} disabled={bal <= 0 || !withdrawAmt.trim()} onClick={withdraw}>
                <ArrowUpFromLine className="w-3.5 h-3.5" /> Withdraw
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
