'use client';

import { useCallback, useEffect, useState } from 'react';
import { CONTRACTS } from '@echo/sdk';
import { useEcho } from '@/lib/sdk';
import { useAgent } from '@/lib/agent';
import { usdc, toUnits } from '@/lib/format';
import { Command } from './Command';
import { Field } from './ui';

const C = CONTRACTS.arcTestnet;

/** Console essentials bar: USDC balance, ERC-8004 identity registration, and the USDC approvals that
 *  gate most write commands. The wallet connect button + notification bell live in the nav. */
export function WalletBar() {
  const { sdk, account } = useEcho();
  const { agentId, setAgentId } = useAgent();

  const [bal, setBal] = useState<bigint>();
  const [allowMR, setAllowMR] = useState<bigint>();
  const [approveAmt, setApproveAmt] = useState('10000');

  const refresh = useCallback(async () => {
    if (!account) return;
    const [b, a] = await Promise.all([
      sdk.usdcBalanceOf(account),
      sdk.usdcAllowance(account, C.marketRegistry),
    ]);
    setBal(b as bigint);
    setAllowMR(a as bigint);
  }, [sdk, account]);

  useEffect(() => { refresh(); }, [refresh]);

  // Nothing useful to show until a wallet is connected — the nav handles connecting.
  if (!account) return null;

  return (
    <div className="border-b border-gray-200 bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="text-gray-500">USDC <b className="text-gray-900 font-mono">{usdc(bal)}</b></span>

        {/* identity */}
        <div className="flex items-center gap-2">
          <span className="text-gray-500">agentId</span>
          <input
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            placeholder="register →"
            className="w-24 px-2 py-1 rounded-md border border-gray-300 font-mono text-xs"
          />
          <Command
            label="Register identity"
            tone="neutral"
            run={async () => {
              const id = await sdk.registerIdentity(account);
              setAgentId(id.toString());
              return id.toString();
            }}
          />
        </div>

        {/* approvals */}
        <div className="flex items-center gap-2 ml-auto">
          <div className="w-28"><Field label="" placeholder="amount" value={approveAmt} onChange={(e) => setApproveAmt(e.target.value)} /></div>
          <Command label="Approve → Market" tone="neutral" onDone={refresh}
            run={() => sdk.approveUSDC(C.marketRegistry, toUnits(approveAmt), account)} />
          <Command label="Approve → Disputes" tone="neutral"
            run={() => sdk.approveUSDC(C.disputeResolver, toUnits(approveAmt), account)} />
        </div>
        <span className="text-xs text-gray-400 w-full">Market allowance: <b className="font-mono">{usdc(allowMR)}</b> · approve before funding markets/bounties/jobs.</span>
      </div>
    </div>
  );
}
