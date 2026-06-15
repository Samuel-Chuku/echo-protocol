'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, gql } from 'urql';
import { useAccount } from 'wagmi';
import { EchoMode, buildMetadata, CONTRACTS } from '@echo/sdk';
import { useEcho } from '@/lib/sdk';
import { useAgent } from '@/lib/agent';
import { Section, Card, Field } from '@/components/ui';
import { Command } from '@/components/Command';
import { toUnits, scope, modeName, modeTagClass, MODE_BLURBS } from '@/lib/format';

const C = CONTRACTS.arcTestnet;

/**
 * Requester home. Create work in two steps — pick a type (#8), then fill its fund form (each create
 * auto-approves the exact USDC it needs, #3) — and a "My markets" list (#12) linking into per-market
 * management at /hire/[id].
 */
export default function HirePage() {
  const { sdk, account } = useEcho();
  const { agentId } = useAgent();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Post a job</h1>
      <p className="text-sm text-gray-500 mb-6">Create work, then manage it. requesterAgentId is your registered agentId ({agentId || '—'}).</p>
      <CreateMarket sdk={sdk} account={account} agentId={agentId} />
      <MyMarkets account={account} />
    </div>
  );
}

/* ──────────────────────────── create: type picker → form ──────────────────────────── */

function CreateMarket({ sdk, account, agentId }: { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; agentId: string }) {
  const [type, setType] = useState<EchoMode | null>(null);
  const need = !account || !agentId;

  if (type === null) {
    return (
      <Section title="Create work" desc="Pick the shape that fits. You can manage it below once it's live.">
        {[EchoMode.OpenMarket, EchoMode.DirectJob, EchoMode.Bounty].map((m) => (
          <button key={m} onClick={() => setType(m)} className="text-left p-5 rounded-2xl border border-gray-200 bg-white hover:border-gray-900 hover:shadow-sm transition">
            <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${modeTagClass(m)}`}>{modeName(m)}</span>
            <p className="mt-3 text-sm text-gray-600">{MODE_BLURBS[m]}</p>
            <span className="mt-3 inline-block text-sm font-medium text-gray-900">Choose →</span>
          </button>
        ))}
      </Section>
    );
  }

  return (
    <Section title={`Create — ${modeName(type)}`} desc="Each create approves the exact USDC it needs, then funds the escrow in one go.">
      <div className="sm:col-span-2">
        <button onClick={() => setType(null)} className="text-xs text-gray-500 hover:text-gray-900 mb-3">← pick a different type</button>
        {need && <p className="text-xs text-amber-600 mb-2">Connect a wallet + register an agentId (top bar) first.</p>}
        {type === EchoMode.OpenMarket && <OpenForm sdk={sdk} account={account} agentId={agentId} disabled={need} />}
        {type === EchoMode.DirectJob && <DirectForm sdk={sdk} account={account} agentId={agentId} disabled={need} />}
        {type === EchoMode.Bounty && <BountyForm sdk={sdk} account={account} agentId={agentId} disabled={need} />}
      </div>
    </Section>
  );
}

type FormProps = { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; agentId: string; disabled: boolean };

function OpenForm({ sdk, account, agentId, disabled }: FormProps) {
  const [subject, setSubject] = useState('');
  const [desc, setDesc] = useState('');
  const [tiers, setTiers] = useState(['5', '50', '250', '1000']);
  const [escrow, setEscrow] = useState('2000');
  const [maxApplicants, setMax] = useState('50');
  const [ghostDays, setGhostDays] = useState('7');
  const [stake, setStake] = useState('10');
  const [flagDays, setFlagDays] = useState('2');
  const [requiredProofs, setProofs] = useState('0');

  return (
    <Card title="Open / Reveal market" hint="tier[0] is the reveal fee R; set stake + flag window for a reveal market.">
      <Field label="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What workers see in browse" />
      <Field label="description" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Scope / terms" />
      <div className="grid grid-cols-4 gap-1">
        {tiers.map((t, i) => (
          <Field key={i} label={['reveal/R', 'shortlist', 'final', 'ghost'][i]} value={t}
            onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? e.target.value : x)))} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1">
        <Field label="escrow USDC" value={escrow} onChange={(e) => setEscrow(e.target.value)} />
        <Field label="max applicants" value={maxApplicants} onChange={(e) => setMax(e.target.value)} />
        <Field label="ghost (days)" value={ghostDays} onChange={(e) => setGhostDays(e.target.value)} />
      </div>
      <div className="grid grid-cols-3 gap-1">
        <Field label="stake USDC (0=none)" value={stake} onChange={(e) => setStake(e.target.value)} />
        <Field label="flag window (days)" value={flagDays} onChange={(e) => setFlagDays(e.target.value)} />
        <Field label="requiredProofs" value={requiredProofs} onChange={(e) => setProofs(e.target.value)} />
      </div>
      <p className="text-xs text-gray-400">Approves {escrow} USDC to the market, then creates.</p>
      <Command label={`Approve ${escrow} + create`} disabled={disabled}
        run={async () => {
          await sdk.ensureUsdcAllowance(C.marketRegistry, toUnits(escrow), account!);
          return sdk.createMarketWithMode({
            metadataURI: buildMetadata({ subject, description: desc }),
            scopeHash: scope(subject || 'console-scope'),
            tierAmounts: tiers.map(toUnits) as unknown as [bigint, bigint, bigint, bigint],
            minPRep: 0n,
            maxApplicants: BigInt(maxApplicants),
            ghostDeadline: BigInt(Number(ghostDays) * 86400),
            escrowTotal: toUnits(escrow),
            requesterAgentId: BigInt(agentId || '0'),
            cfg: {
              mode: EchoMode.OpenMarket,
              requiredProofs: BigInt(requiredProofs),
              stakeRequired: toUnits(stake),
              flagWindow: BigInt(Number(flagDays) * 86400),
            },
          }, account!);
        }} />
    </Card>
  );
}

function DirectForm({ sdk, account, agentId, disabled }: FormProps) {
  const [subject, setSubject] = useState('');
  const [desc, setDesc] = useState('');
  const [worker, setWorker] = useState('');
  const [workerAgentId, setWorkerAgentId] = useState('');
  const [milestones, setMilestones] = useState('100,200,300');
  const [reviewDays, setReviewDays] = useState('3');

  const amounts = () => milestones.split(',').map((s) => toUnits(s.trim()));
  const total = () => amounts().reduce((a, b) => a + b, 0n);

  return (
    <Card title="Direct Job (Mode B)" hint="Two known parties, milestone escrow. Approves the milestone total, then creates.">
      <Field label="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Job title" />
      <Field label="description" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Scope / terms" />
      <Field label="worker address" value={worker} onChange={(e) => setWorker(e.target.value)} placeholder="0x…" />
      <div className="grid grid-cols-2 gap-1">
        <Field label="worker agentId" value={workerAgentId} onChange={(e) => setWorkerAgentId(e.target.value)} />
        <Field label="review (days)" value={reviewDays} onChange={(e) => setReviewDays(e.target.value)} />
      </div>
      <Field label="milestone amounts (USDC, comma)" value={milestones} onChange={(e) => setMilestones(e.target.value)} />
      <Command label="Approve total + create" disabled={disabled || !worker}
        run={async () => {
          await sdk.ensureUsdcAllowance(C.marketRegistry, total(), account!);
          return sdk.createDirectJob({
            worker: worker as `0x${string}`,
            workerAgentId: BigInt(workerAgentId || '0'),
            requesterAgentId: BigInt(agentId || '0'),
            metadataURI: buildMetadata({ subject, description: desc }),
            scopeHash: scope(subject || 'console-job'),
            milestoneAmounts: amounts(),
            reviewWindow: BigInt(Number(reviewDays) * 86400),
          }, account!);
        }} />
    </Card>
  );
}

function BountyForm({ sdk, account, agentId, disabled }: FormProps) {
  const [subject, setSubject] = useState('');
  const [desc, setDesc] = useState('');
  const [pool, setPool] = useState('1000');
  const [defaultAward, setDefaultAward] = useState('50');
  const [reviewDays, setReviewDays] = useState('3');
  const [requiredProofs, setProofs] = useState('0');

  return (
    <Card title="Bounty" hint="Open submissions, parallel winners. Approves the pool, then creates.">
      <Field label="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Bounty title" />
      <Field label="description" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Scope / terms" />
      <div className="grid grid-cols-2 gap-1">
        <Field label="pool USDC" value={pool} onChange={(e) => setPool(e.target.value)} />
        <Field label="default award USDC" value={defaultAward} onChange={(e) => setDefaultAward(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Field label="review (days)" value={reviewDays} onChange={(e) => setReviewDays(e.target.value)} />
        <Field label="requiredProofs" value={requiredProofs} onChange={(e) => setProofs(e.target.value)} />
      </div>
      <p className="text-xs text-gray-400">Approves {pool} USDC to the market, then creates.</p>
      <Command label={`Approve ${pool} + create`} disabled={disabled}
        run={async () => {
          await sdk.ensureUsdcAllowance(C.marketRegistry, toUnits(pool), account!);
          return sdk.createBounty({
            requesterAgentId: BigInt(agentId || '0'),
            metadataURI: buildMetadata({ subject, description: desc }),
            scopeHash: scope(subject || 'console-bounty'),
            requiredProofs: BigInt(requiredProofs),
            defaultAward: toUnits(defaultAward),
            reviewWindow: BigInt(Number(reviewDays) * 86400),
            pool: toUnits(pool),
          }, account!);
        }} />
    </Card>
  );
}

/* ──────────────────────────── my markets (#12) ──────────────────────────── */

const MY_MARKETS = gql`
  query MyMarkets($requester: String!) {
    markets(requester: $requester, limit: 100) {
      id
      mode
      subject
      status
      applicantCount
    }
  }
`;

type MyRow = { id: number; mode: number; subject: string | null; status: string; applicantCount: number };

function MyMarkets({ account }: { account?: `0x${string}` }) {
  const { isConnected } = useAccount();
  const [{ data, fetching, error }] = useQuery<{ markets: MyRow[] }>({
    query: MY_MARKETS,
    variables: { requester: account ?? '' },
    pause: !account,
  });
  const rows = data?.markets ?? [];

  return (
    <Section title="My markets" desc="Markets you created (from the indexer). Click one to manage its lifecycle.">
      <div className="sm:col-span-2">
        <Card title="Your markets">
          {!isConnected && <p className="text-xs text-gray-400">Connect a wallet to see your markets.</p>}
          {isConnected && fetching && rows.length === 0 && <p className="text-xs text-gray-400">Loading…</p>}
          {error && <p className="text-xs text-red-600 break-all">{error.message} — is the indexer running on :4000?</p>}
          {isConnected && !fetching && !error && rows.length === 0 && <p className="text-xs text-gray-400">You haven't created any markets yet.</p>}
          {rows.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {rows.map((m) => (
                <li key={m.id}>
                  <Link href={`/hire/${m.id}`} className="flex items-center gap-3 py-2 hover:bg-gray-50 -mx-1 px-1 rounded">
                    <span className="font-mono text-sm text-gray-500 w-10">#{m.id}</span>
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${modeTagClass(m.mode)}`}>{modeName(m.mode)}</span>
                    <span className="flex-1 text-sm font-medium truncate">{m.subject || <span className="text-gray-400 italic">untitled</span>}</span>
                    <span className="text-xs text-gray-400">{m.status} · {m.applicantCount} appl.</span>
                    <span className="text-gray-300 text-sm">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Section>
  );
}
