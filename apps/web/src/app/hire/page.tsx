'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, ExternalLink } from 'lucide-react';
import { useQuery, gql } from 'urql';
import { useAccount } from 'wagmi';
import { EchoMode, buildMetadata, CONTRACTS } from '@echo/sdk';
import { useEcho } from '@/lib/sdk';
import { useAgent } from '@/lib/agent';
import { Section, Card, Field } from '@/components/ui';
import { ApproveCreate } from '@/components/ApproveCreate';
import { IdentityBanner } from '@/components/IdentityBanner';
import { toUnits, usdc, recommendedEscrow, scope, modeName, modeTagClass, MODE_BLURBS, isTxHash, txLink, short } from '@/lib/format';

const C = CONTRACTS.arcTestnet;

/**
 * Requester home. Create work in two steps — pick a type (#8), then fill its fund form (each create
 * auto-approves the exact USDC it needs, #3) — and a "My markets" list (#12) linking into per-market
 * management at /hire/[id].
 */
export default function HirePage() {
  const { sdk, account } = useEcho();
  const { agentId } = useAgent();
  // Bumped on every successful create. MyMarkets watches it as a query variable so urql treats
  // it as a fresh query and re-fetches — bypasses the cache cleanly without lifting refetch refs.
  const [createdAt, setCreatedAt] = useState(0);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Post a job</h1>
      <p className="text-sm text-gray-500 mb-6">Create work, then manage it. Your identity: agentId {agentId || '—'}.</p>
      <IdentityBanner />
      <CreateMarket sdk={sdk} account={account} agentId={agentId} onCreated={() => setCreatedAt(Date.now())} />
      <MyMarkets account={account} createdAt={createdAt} />
    </div>
  );
}

/* ──────────────────────────── create: type picker → form ──────────────────────────── */

function CreateMarket({ sdk, account, agentId, onCreated }: { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; agentId: string; onCreated: () => void }) {
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
        {need && <p className="text-xs text-amber-600 mb-2">Connect a wallet and register your identity (above) first.</p>}
        {type === EchoMode.OpenMarket && <OpenForm sdk={sdk} account={account} agentId={agentId} disabled={need} onCreated={onCreated} />}
        {type === EchoMode.DirectJob && <DirectForm sdk={sdk} account={account} agentId={agentId} disabled={need} onCreated={onCreated} />}
        {type === EchoMode.Bounty && <BountyForm sdk={sdk} account={account} agentId={agentId} disabled={need} onCreated={onCreated} />}
      </div>
    </Section>
  );
}

type FormProps = { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; agentId: string; disabled: boolean; onCreated: () => void };

/**
 * Number-plus-unit input for time durations. The contract takes seconds, but typing fractional
 * days for a 2-hour smoke-test window is awful — this lets the requester pick minutes / hours /
 * days explicitly and converts at submit time via toSeconds.
 */
type DurationUnit = 'minutes' | 'hours' | 'days';
const UNIT_SECONDS: Record<DurationUnit, number> = { minutes: 60, hours: 3600, days: 86400 };
const toSeconds = (amount: string, unit: DurationUnit): number => Math.max(0, Math.round(Number(amount || '0') * UNIT_SECONDS[unit]));

function DurationField({ label, amount, unit, onAmount, onUnit, hint }: {
  label: string; amount: string; unit: DurationUnit; onAmount: (v: string) => void; onUnit: (u: DurationUnit) => void; hint?: string;
}) {
  return (
    <label className="block" title={hint}>
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{label}</span>
      <div className="mt-0.5 flex gap-1">
        <input
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
          className="flex-1 min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
        />
        <select
          value={unit}
          onChange={(e) => onUnit(e.target.value as DurationUnit)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm bg-white focus:border-gray-500 focus:outline-none"
        >
          <option value="minutes">min</option>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
      </div>
    </label>
  );
}

/** Success banner reused across all three create forms. */
function CreatedBanner({ txHash, onReset }: { txHash: string | null; onReset: () => void }) {
  if (!txHash) return null;
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm flex items-start gap-2">
      <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-emerald-800 font-medium">Created on-chain.</p>
        <p className="text-emerald-700 text-xs mt-0.5">
          It&apos;ll appear under <a href="#my-markets" className="underline">My markets</a> below
          as the indexer catches up (a few seconds).
          {isTxHash(txHash) && (
            <>
              {' '}
              <a href={txLink(txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                Tx: <span className="font-mono">{short(txHash)}</span> <ExternalLink className="w-3 h-3" />
              </a>
            </>
          )}
        </p>
      </div>
      <button onClick={onReset} className="text-xs text-emerald-700 hover:text-emerald-900 underline shrink-0">
        Create another
      </button>
    </div>
  );
}

function OpenForm({ sdk, account, agentId, disabled, onCreated }: FormProps) {
  const [subject, setSubject] = useState('');
  const [desc, setDesc] = useState('');
  const [tiers, setTiers] = useState(['5', '50', '250', '1000']);
  const [escrow, setEscrow] = useState('2000');
  const [escrowDirty, setEscrowDirty] = useState(false);
  const [maxApplicants, setMax] = useState('50');
  // Ghost + flag windows now take a unit so smoke tests can pick hours/minutes without
  // typing fractional days. Defaults still encode the spec-recommended values (7d, 2d).
  const [ghostAmount, setGhostAmount] = useState('7');
  const [ghostUnit, setGhostUnit] = useState<DurationUnit>('days');
  const [stake, setStake] = useState('10');
  const [flagAmount, setFlagAmount] = useState('2');
  const [flagUnit, setFlagUnit] = useState<DurationUnit>('days');
  const [requiredProofs, setProofs] = useState('0');
  const [createdTx, setCreatedTx] = useState<string | null>(null);
  const reset = () => { setSubject(''); setDesc(''); setEscrowDirty(false); setCreatedTx(null); };

  // #7 — mirror the contract's min-escrow so the field pre-fills to a value that can't revert with
  // InsufficientEscrow. Returns undefined if any input isn't yet a valid number.
  const recommended = useMemo(() => {
    try {
      const t = tiers.map(toUnits) as [bigint, bigint, bigint, bigint];
      return recommendedEscrow(t, BigInt(maxApplicants || '0'));
    } catch {
      return undefined;
    }
  }, [tiers, maxApplicants]);

  // Track the recommendation in the escrow field until the requester types their own amount.
  useEffect(() => {
    if (!escrowDirty && recommended !== undefined) setEscrow(usdc(recommended));
  }, [recommended, escrowDirty]);

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
        <Field label="escrow USDC" value={escrow} onChange={(e) => { setEscrowDirty(true); setEscrow(e.target.value); }} />
        <Field label="max applicants" value={maxApplicants} onChange={(e) => setMax(e.target.value)} />
        <DurationField
          label="ghost deadline"
          amount={ghostAmount}
          unit={ghostUnit}
          onAmount={setGhostAmount}
          onUnit={setGhostUnit}
          hint="Final-tier window before triggerGhost can fire"
        />
      </div>
      <div className="grid grid-cols-3 gap-1">
        <Field label="stake USDC (0=none)" value={stake} onChange={(e) => setStake(e.target.value)} />
        <DurationField
          label="flag window"
          amount={flagAmount}
          unit={flagUnit}
          onAmount={setFlagAmount}
          onUnit={setFlagUnit}
          hint="How long the reveal stake is held before it auto-returns"
        />
        <Field label="requiredProofs" value={requiredProofs} onChange={(e) => setProofs(e.target.value)} />
      </div>
      {recommended !== undefined && (
        <p className="text-xs text-gray-500">
          Recommended ≥ <span className="font-medium text-gray-700">{usdc(recommended)} USDC</span> — covers the worst case: every one of {maxApplicants || '0'} applicants paid through all three tiers, plus one ghost reserve.
          {escrowDirty && (
            <button type="button" onClick={() => { setEscrowDirty(false); setEscrow(usdc(recommended)); }} className="ml-1 underline hover:text-gray-900">
              use recommended
            </button>
          )}
        </p>
      )}
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <span className="font-medium">Unused USDC refunds to you.</span> When you click <span className="font-mono">Close market</span> on the manage page, any escrow that wasn&apos;t paid out (e.g. you funded for {maxApplicants || '0'} applicants but only 2 applied) is returned in the same tx. Note: at the Final tier the ghost reserve only pays out if the worker submitted and you didn&apos;t accept (worker-protection). If the worker never submits, the reserve stays in escrow and refunds with the rest on close.
      </div>
      <p className="text-xs text-gray-400">Two steps: approve {escrow} USDC, then create — two wallet confirmations.</p>
      <ApproveCreate
        approveLabel={`Approve ${escrow} USDC`}
        createLabel="Create market"
        disabled={disabled}
        approve={() => sdk.ensureUsdcAllowance(C.marketRegistry, toUnits(escrow), account!)}
        create={() => sdk.createMarketWithMode({
          metadataURI: buildMetadata({ subject, description: desc }),
          scopeHash: scope(subject || 'console-scope'),
          tierAmounts: tiers.map(toUnits) as unknown as [bigint, bigint, bigint, bigint],
          minPRep: 0n,
          maxApplicants: BigInt(maxApplicants),
          ghostDeadline: BigInt(toSeconds(ghostAmount, ghostUnit)),
          escrowTotal: toUnits(escrow),
          requesterAgentId: BigInt(agentId || '0'),
          cfg: {
            mode: EchoMode.OpenMarket,
            requiredProofs: BigInt(requiredProofs),
            stakeRequired: toUnits(stake),
            flagWindow: BigInt(toSeconds(flagAmount, flagUnit)),
          },
        }, account!)}
        onDone={(r) => { setCreatedTx(isTxHash(r) ? (r as string) : 'done'); setSubject(''); setDesc(''); onCreated(); }}
      />
      <CreatedBanner txHash={createdTx} onReset={reset} />
    </Card>
  );
}

function DirectForm({ sdk, account, agentId, disabled, onCreated }: FormProps) {
  const [subject, setSubject] = useState('');
  const [desc, setDesc] = useState('');
  const [worker, setWorker] = useState('');
  const [workerAgentId, setWorkerAgentId] = useState('');
  const [milestones, setMilestones] = useState('100,200,300');
  const [reviewDays, setReviewDays] = useState('3');
  const [createdTx, setCreatedTx] = useState<string | null>(null);
  const reset = () => { setSubject(''); setDesc(''); setWorker(''); setWorkerAgentId(''); setCreatedTx(null); };

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
      <ApproveCreate
        approveLabel="Approve total"
        createLabel="Create job"
        disabled={disabled || !worker}
        approve={() => sdk.ensureUsdcAllowance(C.marketRegistry, total(), account!)}
        create={() => sdk.createDirectJob({
          worker: worker as `0x${string}`,
          workerAgentId: BigInt(workerAgentId || '0'),
          requesterAgentId: BigInt(agentId || '0'),
          metadataURI: buildMetadata({ subject, description: desc }),
          scopeHash: scope(subject || 'console-job'),
          milestoneAmounts: amounts(),
          reviewWindow: BigInt(Number(reviewDays) * 86400),
        }, account!)}
        onDone={(r) => { setCreatedTx(isTxHash(r) ? (r as string) : 'done'); setSubject(''); setDesc(''); setWorker(''); onCreated(); }}
      />
      <CreatedBanner txHash={createdTx} onReset={reset} />
    </Card>
  );
}

function BountyForm({ sdk, account, agentId, disabled, onCreated }: FormProps) {
  const [subject, setSubject] = useState('');
  const [desc, setDesc] = useState('');
  const [pool, setPool] = useState('1000');
  const [defaultAward, setDefaultAward] = useState('50');
  const [reviewDays, setReviewDays] = useState('3');
  const [requiredProofs, setProofs] = useState('0');
  const [createdTx, setCreatedTx] = useState<string | null>(null);
  const reset = () => { setSubject(''); setDesc(''); setCreatedTx(null); };

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
      <p className="text-xs text-gray-400">Two steps: approve {pool} USDC, then create — two wallet confirmations.</p>
      <ApproveCreate
        approveLabel={`Approve ${pool} USDC`}
        createLabel="Create bounty"
        disabled={disabled}
        approve={() => sdk.ensureUsdcAllowance(C.marketRegistry, toUnits(pool), account!)}
        create={() => sdk.createBounty({
          requesterAgentId: BigInt(agentId || '0'),
          metadataURI: buildMetadata({ subject, description: desc }),
          scopeHash: scope(subject || 'console-bounty'),
          requiredProofs: BigInt(requiredProofs),
          defaultAward: toUnits(defaultAward),
          reviewWindow: BigInt(Number(reviewDays) * 86400),
          pool: toUnits(pool),
        }, account!)}
        onDone={(r) => { setCreatedTx(isTxHash(r) ? (r as string) : 'done'); setSubject(''); setDesc(''); onCreated(); }}
      />
      <CreatedBanner txHash={createdTx} onReset={reset} />
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

function MyMarkets({ account, createdAt }: { account?: `0x${string}`; createdAt: number }) {
  const { isConnected } = useAccount();
  const [{ data, fetching, error }, refetch] = useQuery<{ markets: MyRow[] }>({
    query: MY_MARKETS,
    variables: { requester: account ?? '' },
    pause: !account,
    requestPolicy: 'cache-and-network',
  });
  const rows = data?.markets ?? [];

  // Refetch when a new market is created — the indexer needs a few seconds to ingest, so retry
  // a couple of times in case the first hit lands before the event is reduced.
  useEffect(() => {
    if (!createdAt) return;
    const delays = [3000, 8000, 15000];
    const timers = delays.map((ms) => setTimeout(() => refetch({ requestPolicy: 'network-only' }), ms));
    return () => { timers.forEach(clearTimeout); };
  }, [createdAt, refetch]);

  return (
    <Section title="My markets" desc="Markets you created (from the indexer). Click one to manage its lifecycle.">
      <div id="my-markets" className="sm:col-span-2 scroll-mt-24">
        <Card title="Your markets">
          <div className="flex items-center justify-end -mt-1 mb-1">
            <button
              onClick={() => refetch({ requestPolicy: 'network-only' })}
              className="text-xs text-gray-400 hover:text-gray-700 underline"
            >
              Refresh
            </button>
          </div>
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
