'use client';

import { useState } from 'react';
import { EchoMode } from '@echo/sdk';
import { useEcho } from '@/lib/sdk';
import { useAgent } from '@/lib/agent';
import { Section, Card, Field, KV } from '@/components/ui';
import { Command } from '@/components/Command';
import { usdc, scope, short, modeName } from '@/lib/format';

/**
 * Worker console. Browse markets, apply (approve stake first in the top bar if the market requires
 * one), inspect your application/receipt, and deliver work (Mode-B milestone / Bounty finding).
 */
export default function ApplyPage() {
  const { sdk, account } = useEcho();
  const { agentId } = useAgent();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Worker</h1>
      <p className="text-sm text-gray-500 mb-6">Apply with your agentId ({agentId || '—'}). If a market requires a stake, approve USDC → Market in the top bar first.</p>
      <Browse sdk={sdk} />
      <ApplyAndDeliver sdk={sdk} account={account} agentId={agentId} />
    </div>
  );
}

function Browse({ sdk }: { sdk: ReturnType<typeof useEcho>['sdk'] }) {
  const [rows, setRows] = useState<{ id: number; mode: number; requester: string; applicants: string; closed: boolean }[]>([]);
  const [err, setErr] = useState('');

  async function load() {
    setErr('');
    try {
      const count = Number(await sdk.marketCount());
      const out: typeof rows = [];
      for (let i = 1; i <= count; i++) {
        const id = BigInt(i);
        const [mode, m] = await Promise.all([sdk.marketMode(id).catch(() => 0), sdk.getMarket(id).catch(() => null)]);
        out.push({
          id: i,
          mode: Number(mode),
          requester: (m as any)?.requester ?? '0x0',
          applicants: String((m as any)?.applicantCount ?? '—'),
          closed: Boolean((m as any)?.closed),
        });
      }
      setRows(out.reverse());
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || String(e));
    }
  }

  return (
    <Section title="Browse markets" desc="Reads marketCount then each market directly (no indexer yet).">
      <Card title="All markets">
        <Command label="Load markets" tone="neutral" run={load} />
        {err && <p className="text-xs text-red-600">{err}</p>}
        {rows.length > 0 && (
          <KV rows={rows.map((r) => [`#${r.id} · ${modeName(r.mode)}`, `${short(r.requester)} · ${r.applicants} appl.${r.closed ? ' · closed' : ''}`])} />
        )}
      </Card>
    </Section>
  );
}

function ApplyAndDeliver({ sdk, account, agentId }: { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; agentId: string }) {
  const [id, setId] = useState('1');
  const [submission, setSubmission] = useState('my-application-v1');
  const [app, setApp] = useState<any>(null);
  const [idx, setIdx] = useState('0');
  const [deliver, setDeliver] = useState('deliverable-v1');
  const mid = () => BigInt(id || '0');
  const aid = () => BigInt(agentId || '0');

  return (
    <Section title="Apply & deliver" desc="Apply to a market, then deliver (milestone / finding).">
      <Card title="Apply to market" hint="applyToMarket — mints a participation receipt; pulls the stake if the market requires one.">
        <div className="grid grid-cols-2 gap-1">
          <Field label="marketId" value={id} onChange={(e) => setId(e.target.value)} />
          <Field label="submission text → hash" value={submission} onChange={(e) => setSubmission(e.target.value)} />
        </div>
        <Command label="Apply" disabled={!account || !agentId}
          run={() => sdk.applyToMarket(mid(), aid(), scope(submission), account!)} />
        <Command label="Load my application" tone="neutral" disabled={!account}
          run={async () => { setApp(await sdk.getApplication(mid(), account!)); return 'loaded'; }} />
        {app && (
          <KV rows={[
            ['tier reached', String(app.tierReached)],
            ['agentId', String(app.agentId)],
            ['receipt #', String(app.receiptTokenId)],
            ['withdrawn', String(app.withdrawn)],
          ]} />
        )}
      </Card>

      <Card title="Deliver" hint="submitMilestone (Mode B) / submitFinding (Bounty). Index is the milestone slot; finding appends.">
        <div className="grid grid-cols-2 gap-1">
          <Field label="index (milestone)" value={idx} onChange={(e) => setIdx(e.target.value)} />
          <Field label="deliverable text → hash" value={deliver} onChange={(e) => setDeliver(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Command label="Submit milestone" disabled={!account} run={() => sdk.submitMilestone(mid(), BigInt(idx), scope(deliver), account!)} />
          <Command label="Submit finding" disabled={!account || !agentId} run={() => sdk.submitFinding(mid(), aid(), scope(deliver), account!)} />
        </div>
      </Card>
    </Section>
  );
}
