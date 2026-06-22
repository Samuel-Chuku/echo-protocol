'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useEcho } from '@/lib/sdk';
import { CIRCLE_CONNECTOR_ID } from '@/lib/circle';
import { usdc, toUnits } from '@/lib/format';
import { Card, Field } from './ui';
import { Command } from './Command';

/** True only when the connected wallet is the Circle passkey (smart account). Sending is offered to
 *  passkey users only — EOAs send from their own wallet UI. */
export function useIsPasskeyWallet(): boolean {
  const { connector, isConnected } = useAccount();
  return isConnected && connector?.id === CIRCLE_CONNECTOR_ID;
}

/**
 * The Send-USDC form. A plain ERC-20 transfer from the connected smart account (sponsored userOp on
 * Arc), routed through the tx overlay via Command. Shared by the profile card and the nav modal.
 */
export function SendUsdcCard({ onSent }: { onSent?: () => void }) {
  const { sdk, account } = useEcho();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [bal, setBal] = useState<bigint>();

  const loadBal = async () => {
    if (!account) return;
    setBal((await sdk.usdcBalanceOf(account).catch(() => undefined)) as bigint | undefined);
  };
  useEffect(() => { loadBal(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [account]);

  const validTo = /^0x[0-9a-fA-F]{40}$/.test(to.trim());
  const amt = (() => { try { return amount ? toUnits(amount) : 0n; } catch { return 0n; } })();
  const overBalance = bal !== undefined && amt > bal;
  const disabled = !account || !validTo || amt <= 0n || overBalance;

  return (
    <Card title="Send USDC" hint="A transfer from your passkey wallet. Gas is sponsored on Arc.">
      <p className="text-xs text-gray-500">Balance: <b className="font-mono">{bal !== undefined ? usdc(bal) : '—'} USDC</b></p>
      <Field label="recipient address" value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" />
      <Field label="amount (USDC)" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      {to && !validTo && <p className="text-xs text-amber-600">Enter a valid 0x address.</p>}
      {overBalance && <p className="text-xs text-amber-600">Amount exceeds your balance.</p>}
      <Command
        label={amt > 0n && validTo ? `Send ${amount} USDC` : 'Send USDC'}
        disabled={disabled}
        onDone={() => { setTo(''); setAmount(''); loadBal(); onSent?.(); }}
        run={() => sdk.transferUsdc(to.trim() as `0x${string}`, amt, account!)}
      />
    </Card>
  );
}
