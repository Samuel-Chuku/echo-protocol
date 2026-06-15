'use client';

import { useState } from 'react';
import { useQuery, gql } from 'urql';
import { useEcho } from '@/lib/sdk';
import { useAgent } from '@/lib/agent';
import { Section, Card, Field, KV } from '@/components/ui';
import { Command } from '@/components/Command';
import { scope, short, modeName, modeTagClass } from '@/lib/format';

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
      <Browse />
      <ApplyAndDeliver sdk={sdk} account={account} agentId={agentId} />
    </div>
  );
}

const OPEN_MARKETS = gql`
  query OpenMarkets {
    markets(openOnly: true, limit: 100) {
      id
      mode
      requester
      subject
      description
      status
      applicantCount
    }
  }
`;

type MarketRow = {
  id: number;
  mode: number;
  requester: string;
  subject: string | null;
  description: string | null;
  status: string;
  applicantCount: number;
};

/** Reads open markets from the GraphQL indexer (no per-market RPC loop). Each row shows its subject
 *  and a mode tag/color. Markets created before the metadata convention surface with no subject. */
function Browse() {
  const [{ data, fetching, error }, refetch] = useQuery<{ markets: MarketRow[] }>({ query: OPEN_MARKETS });
  const rows = data?.markets ?? [];

  return (
    <Section title="Browse markets" desc="Open markets from the Echo indexer (GraphQL). Apply to one below by id.">
      <Card title="Open markets">
        <Command label="Refresh" tone="neutral" run={async () => { refetch({ requestPolicy: 'network-only' }); return 'refreshed'; }} />
        {fetching && rows.length === 0 && <p className="text-xs text-gray-400">Loading…</p>}
        {error && <p className="text-xs text-red-600 break-all">{error.message} — is the indexer running on :4000?</p>}
        {!fetching && !error && rows.length === 0 && <p className="text-xs text-gray-400">No open markets yet.</p>}
        {rows.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {rows.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2">
                <span className="font-mono text-sm text-gray-500 w-10">#{m.id}</span>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${modeTagClass(m.mode)}`}>{modeName(m.mode)}</span>
                <span className="flex-1 text-sm font-medium truncate">{m.subject || <span className="text-gray-400 italic">untitled market</span>}</span>
                <span className="text-xs text-gray-400">{short(m.requester)} · {m.applicantCount} appl.</span>
              </li>
            ))}
          </ul>
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
