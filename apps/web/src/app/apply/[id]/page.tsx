'use client';

import { use, useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useQuery, useClient, gql } from 'urql';
import { EchoMode, CONTRACTS } from '@echo/sdk';
import { useEcho } from '@/lib/sdk';
import { useAgent } from '@/lib/agent';
import { useContent } from '@/lib/content';
import { ACTIVITY_QUERY, type ActivityRow } from '@/lib/activity';
import { Section, Card, Field, KV } from '@/components/ui';
import { Command } from '@/components/Command';
import { Receipt } from '@/components/Receipt';
import { IdentityBanner } from '@/components/IdentityBanner';
import { usdc, scope, short, modeName, modeTagClass, isZeroAddr, txLink, toUnits, MILESTONE_STATUS } from '@/lib/format';

// Worker-recourse: an open/resolved tier-rejection dispute for a given job, read from the indexer.
// subject 2 = TierJobRejection; target = the Arc jobId.
const TIER_DISPUTES_QUERY = gql`
  query TierDisputes {
    disputes { id subject target opener counter status forOpener against }
  }
`;

// Arc AgenticCommerce JobStatus enum (IERC8183.sol:23-30). Drives the per-tier-job UI gates:
// Open → worker submits, Funded → (Echo skips, budget==0), Submitted → requester accepts, Completed → paid.
const JOB_STATUS = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired'];
const JOB_STATUS_CLASS = [
  'bg-sky-50 text-sky-700 border-sky-200',
  'bg-sky-50 text-sky-700 border-sky-200',
  'bg-amber-50 text-amber-700 border-amber-200',
  'bg-emerald-50 text-emerald-700 border-emerald-200',
  'bg-red-50 text-red-700 border-red-200',
  'bg-gray-100 text-gray-600 border-gray-200',
];

// EchoHook.Tier enum (EchoHook.sol:38-46) — Substantive/Shortlist/Final are the three Open-mode tiers
// that get an Arc job. (Ghost/Milestone/Finding are bookkeeping only, never appear in tierJobIds.)
const HOOK_TIER_LABELS: Record<number, string> = {
  0: 'Submitted', 1: 'Substantive', 2: 'Shortlist', 3: 'Final',
  4: 'Ghost', 5: 'Milestone', 6: 'Finding',
};

const C = CONTRACTS.arcTestnet;

/**
 * Worker job-detail page (#7). Full subject/description + terms from the indexer, an apply CTA, and a
 * deliver section that appears ONLY when the connected wallet is actually a worker-party in this job:
 *  - Direct Job: the assigned worker submits milestones.
 *  - Bounty: any registered agent submits findings.
 *  - Open/Reveal: apply (grading + advancement are requester-side, so there's nothing to "deliver").
 */
const MARKET = gql`
  query Market($id: Int!) {
    market(id: $id) {
      id mode requester worker subject description status
      tiers escrowTotal revealFee defaultAward pool applicantCount reviewWindow
    }
  }
`;

type MarketDetail = {
  id: number; mode: number; requester: string; worker: string | null;
  subject: string | null; description: string | null; status: string;
  tiers: string[] | null; escrowTotal: string | null; revealFee: string | null;
  defaultAward: string | null; pool: string | null; applicantCount: number; reviewWindow: number | null;
};

const u = (s: string | null | undefined) => (s ? usdc(BigInt(s)) : '—');

/** Mode-specific terms rows for the KV panel. */
function termsRows(m: MarketDetail): [string, ReactNode][] {
  const rows: [string, ReactNode][] = [
    ['status', m.status],
    ['requester', <Link key="req" href={`/u/${m.requester}`} className="hover:underline">{short(m.requester)}</Link>],
  ];
  if (m.mode === EchoMode.OpenMarket) {
    rows.push(['escrow', u(m.escrowTotal)]);
    rows.push(['reveal fee R', m.revealFee && m.revealFee !== '0' ? u(m.revealFee) : '—']);
    rows.push(['applicants', String(m.applicantCount)]);
  } else if (m.mode === EchoMode.DirectJob) {
    rows.push(['worker', isZeroAddr(m.worker ?? undefined) ? '—' : short(m.worker ?? undefined)]);
    rows.push(['escrow', u(m.escrowTotal)]);
  } else if (m.mode === EchoMode.Bounty) {
    rows.push(['pool', u(m.pool)]);
    rows.push(['default award', u(m.defaultAward)]);
  }
  return rows;
}

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { sdk, account } = useEcho();
  const { agentId } = useAgent();

  const [{ data, fetching, error }] = useQuery<{ market: MarketDetail | null }>({ query: MARKET, variables: { id: Number(id) } });
  const m = data?.market ?? null;

  return (
    <div>
      <Link href="/apply" className="text-xs text-gray-500 hover:text-gray-900">← Find work</Link>
      <div className="flex items-center gap-3 mt-1 mb-1">
        <h1 className="text-2xl font-bold">{m?.subject || `Market #${id}`}</h1>
        {m && <span className={`rounded px-2 py-0.5 text-xs font-medium ${modeTagClass(m.mode)}`}>{modeName(m.mode)}</span>}
      </div>

      <div className="mt-4"><IdentityBanner /></div>

      {/* /apply/[id] is the public worker-facing view; when the connected wallet owns this market we
       *  surface a banner that links to /hire/[id] (the management view). We DON'T auto-redirect —
       *  the requester might legitimately want to preview their market the way applicants see it. */}
      {m && account && account.toLowerCase() === m.requester.toLowerCase() && (
        <div className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm flex items-center gap-2">
          <span className="text-indigo-900">You created this market — you&apos;re viewing the applicant page.</span>
          <Link href={`/hire/${id}`} className="ml-auto inline-flex items-center gap-1 text-indigo-700 font-medium underline">
            Manage instead →
          </Link>
        </div>
      )}

      {fetching && !m && <p className="text-sm text-gray-400">Loading…</p>}
      {error && <p className="text-sm text-red-600 break-all">{error.message} — is the indexer running on :4000?</p>}
      {!fetching && !error && !m && <p className="text-sm text-gray-400">No market #{id} in the indexer.</p>}

      {m && (
        <>
          <Section title="Details" desc="Terms for this job, from the indexer.">
            <Card title="About">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{m.description || <span className="text-gray-400 italic">No description provided.</span>}</p>
            </Card>
            <Card title="Terms">
              <KV rows={termsRows(m)} />
            </Card>
            <div className="sm:col-span-2">
              <Receipt
                marketId={m.id}
                mode={m.mode}
                status={m.status}
                requester={m.requester}
                worker={m.mode === EchoMode.DirectJob ? m.worker : undefined}
                amount={m.mode === EchoMode.Bounty ? m.pool : m.escrowTotal}
                amountLabel={m.mode === EchoMode.Bounty ? 'Pool' : 'Escrow'}
              />
            </div>
          </Section>

          {m.mode === EchoMode.OpenMarket && <OpenApply sdk={sdk} account={account} agentId={agentId} marketId={BigInt(id)} closed={m.status !== 'active'} />}
          {m.mode === EchoMode.DirectJob && <DirectDeliver sdk={sdk} account={account} marketId={BigInt(id)} worker={m.worker} />}
          {m.mode === EchoMode.Bounty && <BountyDeliver sdk={sdk} account={account} agentId={agentId} marketId={BigInt(id)} closed={m.status !== 'active'} />}
        </>
      )}
    </div>
  );
}

/* ──────────────── Open/Reveal: apply ──────────────── */
const TIER_NAMES = ['Applied', 'Revealed', 'Shortlist', 'Final'];

function OpenApply({ sdk, account, agentId, marketId, closed }: { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; agentId: string; marketId: bigint; closed: boolean }) {
  const [submission, setSubmission] = useState('');
  const [app, setApp] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [savedBody, setSavedBody] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const need = !account || !agentId;
  const { store: storeContent, fetch: fetchContent } = useContent();

  // Auto-detect: hit getApplication on mount (and whenever the wallet changes) so the user sees
  // their status right away instead of having to click a "Load my application" button. The SDK
  // returns a zero-state object when there's no record, so a non-zero agentId means "applied".
  const refreshApp = useCallback(async () => {
    if (!account) { setApp(null); return; }
    setLoading(true);
    try { setApp(await sdk.getApplication(marketId, account)); } catch { setApp(null); }
    finally { setLoading(false); }
  }, [account, marketId, sdk]);
  useEffect(() => { refreshApp(); }, [refreshApp]);

  const hasApplied = !!app && app.agentId !== undefined && BigInt(app.agentId ?? 0) !== 0n;

  // "Revealed, under review" gap (reveal markets only): the worker is at tier 1 but no tier job
  // exists yet — reveal is atomic (no Arc job), so their next action only appears once the requester
  // grades them to Shortlist. Surface that they've been paid + link the reveal tx so it doesn't feel
  // like dead air. On non-reveal markets tier 1 already has a Substantive job, so this never shows.
  const client = useClient();
  const tierReached = Number(app?.tierReached ?? 0);
  const awaitingAdvance = hasApplied && tierReached === 1 && ((app?.tierJobIds ?? []) as bigint[]).length === 0;
  const [revealFee, setRevealFee] = useState<bigint | null>(null);
  const [revealTx, setRevealTx] = useState<string | null>(null);
  useEffect(() => {
    if (!awaitingAdvance || !account) return;
    let cancelled = false;
    (async () => {
      try {
        const fee = await sdk.revealFee(marketId).catch(() => null);
        if (!cancelled && fee != null) setRevealFee(fee as bigint);
        const res = await client.query(ACTIVITY_QUERY, { address: account, limit: 100 }).toPromise();
        const rows = (res.data?.activity ?? []) as ActivityRow[];
        const reveal = rows.find((r) => r.eventName === 'Revealed' && r.marketId === Number(marketId)
          && r.actor?.toLowerCase() === account.toLowerCase());
        if (!cancelled) setRevealTx(reveal?.txHash ?? null);
      } catch { /* non-fatal — the hint still renders without the amount/tx */ }
    })();
    return () => { cancelled = true; };
  }, [awaitingAdvance, account, marketId, sdk, client]);

  // After applying, pre-load the body the worker stored (so it survives refresh). Failures are
  // non-fatal — the body is optional context, not the source of truth (the on-chain hash is).
  useEffect(() => {
    if (!hasApplied || !account) return;
    let cancelled = false;
    (async () => {
      try {
        const row = await fetchContent(Number(marketId), 'apply', account, account);
        if (!cancelled) setSavedBody(row?.body ?? null);
      } catch { /* not stored yet — leave null */ }
    })();
    return () => { cancelled = true; };
  }, [hasApplied, account, marketId, fetchContent]);

  return (
    <>
      <Section title="Apply" desc="Submit your application. The requester reveals, grades, and advances applicants through tiers.">
        <Card title={hasApplied ? 'Your application' : 'Apply to this market'} hint={hasApplied ? undefined : 'Writes your application text to the indexer (gated to you + requester after reveal), then applyToMarket commits the hash + stake on chain.'}>
          {loading && !app && <p className="text-xs text-gray-400">Checking…</p>}
          {hasApplied ? (
            <>
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                You&apos;ve already applied. The requester reveals to read your application, then grades you through the tiers below.
              </p>
              <KV rows={[
                ['tier reached', TIER_NAMES[Number(app.tierReached)] ?? String(app.tierReached)],
                ['agentId', String(app.agentId)],
                ['receipt #', String(app.receiptTokenId)],
                ['withdrawn', String(app.withdrawn)],
              ]} />
              {savedBody !== null && (
                <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Your application body (saved off-chain)</div>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{savedBody}</p>
                </div>
              )}
              {savedBody === null && (
                <p className="text-xs text-amber-600">No application body found — the chain has your hash but no readable text was stored. Re-submitting requires a fresh application.</p>
              )}
              {awaitingAdvance && (
                <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 space-y-1">
                  <p className="font-medium">Revealed — the requester is reviewing your application.</p>
                  <p>
                    You&apos;ve been paid for being revealed
                    {revealFee != null ? ` (reveal fee: ${usdc(revealFee)} USDC)` : ''}. If they advance
                    you, a Shortlist round will appear below and you&apos;ll submit a deliverable there.
                  </p>
                  {revealTx && (
                    <a href={txLink(revealTx)} target="_blank" rel="noreferrer"
                      className="inline-block underline hover:text-blue-700">
                      View reveal payment ↗
                    </a>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <label className="block text-xs uppercase tracking-wide text-gray-500 mb-1">Application body — your pitch / writeup</label>
              <textarea
                value={submission}
                onChange={(e) => setSubmission(e.target.value)}
                rows={6}
                placeholder="Write your application here. Hashed on chain; full text stored on the indexer and gated to you + the requester after they pay to reveal."
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
              />
              {bodyError && <p className="text-xs text-red-600">{bodyError}</p>}
              {closed && <p className="text-xs text-amber-600">This market is no longer active.</p>}
              {need && <p className="text-xs text-amber-600">Register your identity (banner above) first.</p>}
              <Command label="Apply" disabled={need || closed || !submission.trim()}
                onDone={() => { setSubmission(''); refreshApp(); }}
                run={async () => {
                  setBodyError(null);
                  const body = submission.trim();
                  if (!body) throw new Error('Application body required');
                  // Off-chain first — if storeContent fails (signature rejected, indexer down) we
                  // bail before sending a tx the requester can't read anyway.
                  try {
                    await storeContent(Number(marketId), 'apply', account!, body, account!);
                  } catch (e: unknown) {
                    setBodyError(e instanceof Error ? e.message : 'Failed to store application body');
                    throw e;
                  }
                  const stake = await sdk.marketStakeRequired(marketId).catch(() => 0n);
                  if (stake > 0n) await sdk.ensureUsdcAllowance(C.marketRegistry, stake, account!);
                  return sdk.applyToMarket(marketId, BigInt(agentId || '0'), scope(body), account!);
                }} />
            </>
          )}
        </Card>
      </Section>

      {hasApplied && account && (
        <TierJobs
          sdk={sdk}
          account={account}
          marketId={marketId}
          tierJobIds={(app?.tierJobIds ?? []) as bigint[]}
          onChanged={refreshApp}
        />
      )}
    </>
  );
}

/* ──────────────── Open/Reveal: per-tier deliverables ──────────────── */

type TierJob = {
  jobId: bigint;
  arcJob: { provider: `0x${string}`; evaluator: `0x${string}`; status: number; expiredAt: bigint } | null;
  ctx: { tier: number; tierAmount: bigint; ghostDeadline: bigint } | null;
};

function TierJobs({ sdk, account, marketId, tierJobIds, onChanged }: {
  sdk: ReturnType<typeof useEcho>['sdk']; account: `0x${string}`; marketId: bigint;
  tierJobIds: bigint[]; onChanged: () => void;
}) {
  const [jobs, setJobs] = useState<TierJob[]>([]);
  const [loading, setLoading] = useState(false);
  const idsKey = tierJobIds.map((j) => j.toString()).join(',');

  const load = useCallback(async () => {
    if (tierJobIds.length === 0) { setJobs([]); return; }
    setLoading(true);
    try {
      const rows = await Promise.all(tierJobIds.map(async (jobId) => {
        const [arcJob, ctx] = await Promise.all([
          sdk.getArcJob(jobId).catch(() => null) as Promise<TierJob['arcJob']>,
          sdk.getJobContext(jobId).catch(() => null) as Promise<TierJob['ctx']>,
        ]);
        return { jobId, arcJob, ctx };
      }));
      setJobs(rows);
    } finally { setLoading(false); }
  }, [sdk, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  if (tierJobIds.length === 0) {
    return (
      <Section title="Tier jobs" desc="Once the requester grades you to a tier, an Arc job is created here. You submit a deliverable to that job; the requester accepts to release payment.">
        <Card title="No tier jobs yet">
          <p className="text-sm text-gray-500">Waiting for the requester to reveal + grade your application.</p>
        </Card>
      </Section>
    );
  }

  return (
    <Section title="Tier jobs" desc="Each grade spawned an Arc job. Submit your deliverable; the requester accepts to release that tier's payment (or it ghosts after the deadline on the Final job).">
      {loading && jobs.length === 0 && <p className="text-xs text-gray-400">Loading jobs…</p>}
      {jobs.map((j) => (
        <TierJobCard key={j.jobId.toString()} sdk={sdk} account={account} marketId={marketId} job={j} onChanged={() => { load(); onChanged(); }} />
      ))}
    </Section>
  );
}

function TierJobCard({ sdk, account, marketId, job, onChanged }: {
  sdk: ReturnType<typeof useEcho>['sdk']; account: `0x${string}`; marketId: bigint;
  job: TierJob; onChanged: () => void;
}) {
  const [deliverable, setDeliverable] = useState('');
  const [savedBody, setSavedBody] = useState<string | null>(null);
  const [rejectBody, setRejectBody] = useState<string | null>(null);
  const [rev, setRev] = useState<{ used: boolean; extensions: number }>({ used: false, extensions: 0 });
  const [ghostDeadline, setGhostDeadline] = useState<bigint>(0n);
  const [err, setErr] = useState<string | null>(null);
  const [bond, setBond] = useState('25');
  const [disp, setDisp] = useState<{ id: number; status: number; forOpener: number; against: number } | null>(null);
  const { store: storeContent, fetch: fetchContent } = useContent();
  const client = useClient();
  const status = job.arcJob?.status ?? 0;
  const tier = job.ctx?.tier ?? 0;
  const amount = job.ctx?.tierAmount ?? 0n;
  const expiredAt = job.arcJob?.expiredAt ?? 0n;
  const isProvider = job.arcJob && job.arcJob.provider.toLowerCase() === account.toLowerCase();

  // Pull any deliverable already stored for this job so the worker sees what they submitted.
  useEffect(() => {
    if (!isProvider) return;
    let cancelled = false;
    (async () => {
      try {
        const row = await fetchContent(Number(marketId), 'deliver', job.jobId.toString(), account);
        if (!cancelled) setSavedBody(row?.body ?? null);
      } catch { /* not stored yet */ }
    })();
    return () => { cancelled = true; };
  }, [isProvider, marketId, job.jobId, account, fetchContent]);

  // If the requester rejected this tier job, pull the reason they left (if any) so the worker
  // learns *why* — the content channel gates this to the job's provider + evaluator.
  useEffect(() => {
    if (!isProvider || status !== 4) return;
    let cancelled = false;
    (async () => {
      try {
        const row = await fetchContent(Number(marketId), 'reject', job.jobId.toString(), account);
        if (!cancelled) setRejectBody(row?.body ?? null);
      } catch { /* no reason stored */ }
    })();
    return () => { cancelled = true; };
  }, [isProvider, status, marketId, job.jobId, account, fetchContent]);

  // Final-tier revision state: whether the requester sent it back (used) + extensions spent, and the
  // live ghost deadline (the clock revision/extensions push out). Drives the "Revision requested" hint
  // and the worker's self-extend buttons. Only meaningful on the Final job (tier 3).
  useEffect(() => {
    if (!isProvider || tier !== 3) return;
    let cancelled = false;
    (async () => {
      try {
        const [info, gd] = await Promise.all([
          sdk.revisionInfo(job.jobId),
          sdk.ghostDeadline(job.jobId).catch(() => 0n),
        ]);
        if (!cancelled) { setRev(info); setGhostDeadline(gd); }
      } catch { /* pre-upgrade impl or read failed — leave defaults */ }
    })();
    return () => { cancelled = true; };
  }, [isProvider, tier, status, job.jobId, sdk]);

  // Worker-recourse: if the requester rejected this Final job, surface any existing tier-rejection
  // dispute (subject 2, target = jobId) so we can show its state instead of the "contest" CTA.
  useEffect(() => {
    if (!isProvider || status !== 4 || tier !== 3) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await client.query(TIER_DISPUTES_QUERY, {}).toPromise();
        const rows = (res.data?.disputes ?? []) as any[];
        const mine = rows.find((r) => Number(r.subject) === 2 && Number(r.target) === Number(job.jobId));
        if (!cancelled) setDisp(mine ? { id: Number(mine.id), status: Number(mine.status), forOpener: Number(mine.forOpener), against: Number(mine.against) } : null);
      } catch { /* indexer unreachable — leave the contest CTA available */ }
    })();
    return () => { cancelled = true; };
  }, [isProvider, status, tier, job.jobId, client]);

  // The worker is in a revision when the requester reopened it (rev.used) and the job is back to Open
  // with a prior deliverable already saved — i.e. this is a re-submit, not a first submit.
  const inRevision = isProvider && status === 0 && rev.used && savedBody !== null;
  const nextGrant = ['+45m', '+30m', '+15m'][rev.extensions] ?? '';

  return (
    <Card title={`${HOOK_TIER_LABELS[tier] ?? `Tier ${tier}`} — job #${job.jobId.toString()}`} hint={`Pays ${usdc(amount)} USDC on accept.`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`rounded border px-2 py-0.5 text-xs font-medium ${JOB_STATUS_CLASS[status] ?? JOB_STATUS_CLASS[0]}`}>
          {JOB_STATUS[status] ?? `status ${status}`}
        </span>
        {/* For the Final job the real clock is EchoHook's ghost deadline (which revision + extensions
            push out); the Arc job's own expiredAt can drift from it, so prefer ghostDeadline here. */}
        {tier === 3 && ghostDeadline > 0n ? (
          <span className="text-xs text-gray-500">ghosts at {new Date(Number(ghostDeadline) * 1000).toLocaleString()}</span>
        ) : expiredAt > 0n ? (
          <span className="text-xs text-gray-500">
            {tier === 3 ? 'ghosts at' : 'expires at'} {new Date(Number(expiredAt) * 1000).toLocaleString()}
          </span>
        ) : null}
      </div>

      {inRevision && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 space-y-2">
          <p className="text-xs text-amber-800 font-medium">
            Revision requested — update your deliverable below and resubmit.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {rev.extensions < 3 ? (
              <Command label={`Extend deadline ${nextGrant}`} tone="neutral"
                onDone={onChanged}
                run={() => sdk.extendRevision(job.jobId, account)} />
            ) : (
              <span className="text-[11px] text-gray-500">No extensions left.</span>
            )}
            <span className="text-[11px] text-gray-500">{rev.extensions}/3 extensions used</span>
          </div>
        </div>
      )}

      {status === 0 && isProvider && (
        <>
          <label className="block text-xs uppercase tracking-wide text-gray-500 mt-2 mb-1">Deliverable for this tier</label>
          <textarea
            value={deliverable}
            onChange={(e) => setDeliverable(e.target.value)}
            rows={5}
            placeholder={tier === 3 ? 'Final deliverable — the actual work product the requester is paying for.' : 'Whatever you owe at this stage (case study, take-home, plan, etc).'}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
          />
          {err && <p className="text-xs text-red-600">{err}</p>}
          <Command label="Submit deliverable" disabled={!deliverable.trim()}
            onDone={() => { setDeliverable(''); onChanged(); }}
            run={async () => {
              setErr(null);
              const body = deliverable.trim();
              try {
                await storeContent(Number(marketId), 'deliver', job.jobId.toString(), body, account);
              } catch (e: unknown) {
                setErr(e instanceof Error ? e.message : 'Failed to store deliverable');
                throw e;
              }
              return sdk.submitTierJob(job.jobId, scope(body), account);
            }} />
        </>
      )}

      {status === 0 && !isProvider && (
        <p className="text-xs text-gray-500 mt-2">Connect as the assigned provider to submit a deliverable here.</p>
      )}

      {(status === 2 || status === 3) && savedBody !== null && (
        <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Your deliverable (saved off-chain)</div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{savedBody}</p>
        </div>
      )}

      {status === 3 && (
        <p className="text-xs text-emerald-700 mt-2">Accepted — {usdc(amount)} USDC paid out. Tx on-chain via EchoHook settlement.</p>
      )}
      {status === 2 && (
        <p className="text-xs text-amber-700 mt-2">Submitted. Waiting on the requester to accept → release payment.</p>
      )}
      {status === 4 && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs text-amber-800 font-medium">Rejected by the requester — this tier was not paid.</p>
          {rejectBody !== null
            ? <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap"><span className="text-[10px] uppercase tracking-wide text-gray-500">Reason: </span>{rejectBody}</p>
            : <p className="mt-1 text-xs text-gray-500 italic">No reason was provided.</p>}

          {/* Worker recourse: contest an unfair Final-tier reject via the staked-jury panel. */}
          {tier === 3 && isProvider && (
            disp ? (
              <div className="mt-2 border-t border-amber-200 pt-2">
                <p className="text-xs text-gray-700">
                  You contested this rejection — dispute #{disp.id} is{' '}
                  {disp.status === 1
                    ? (disp.forOpener >= disp.against ? 'resolved in your favor (paid).' : 'resolved: rejection upheld.')
                    : 'open. The requester must counter, then the jury votes.'}
                </p>
                <Link href="/disputes" className="text-xs text-sky-700 hover:underline">Track in Disputes →</Link>
              </div>
            ) : (
              <div className="mt-2 border-t border-amber-200 pt-2 space-y-1">
                <p className="text-xs text-gray-700">Think this was unfair? Contest it — a staked jury decides, and a tie pays you.</p>
                <div className="flex items-end gap-2">
                  <Field label="bond USDC" value={bond} onChange={(e) => setBond(e.target.value)} />
                  <Command label="Contest this rejection" disabled={!bond.trim()}
                    onDone={onChanged}
                    run={async () => {
                      await sdk.ensureUsdcAllowance(CONTRACTS.arcTestnet.disputeResolver, toUnits(bond), account);
                      return sdk.openTierJobDispute(marketId, job.jobId, toUnits(bond), account);
                    }} />
                </div>
                <p className="text-[11px] text-gray-500">Posts a USDC bond. If the jury sides with you (or ties), you’re paid the tier amount and refunded the bond; if not, the bond is forfeit.</p>
              </div>
            )
          )}
        </div>
      )}
    </Card>
  );
}

/* ──────────────── Direct Job: milestones (worker-party only) ──────────────── */
function DirectDeliver({ sdk, account, marketId, worker }: { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; marketId: bigint; worker: string | null }) {
  const isWorker = !!account && !!worker && account.toLowerCase() === worker.toLowerCase();
  const [milestones, setMilestones] = useState<any[]>([]);
  const [idx, setIdx] = useState('0');
  const [deliver, setDeliver] = useState('deliverable-v1');

  const load = async () => { setMilestones((await sdk.getDirectJobMilestones(marketId).catch(() => [])) as any[]); };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [marketId.toString()]);

  if (!isWorker) {
    return (
      <Section title="Deliver" desc="Milestone submission is restricted to the assigned worker.">
        <Card title="Assigned worker only">
          <p className="text-sm text-gray-500">
            This direct job is assigned to {isZeroAddr(worker ?? undefined) ? 'an unset address' : short(worker ?? undefined)}.
            {account ? ' Your connected wallet is not the worker.' : ' Connect the worker wallet to submit milestones.'}
          </p>
        </Card>
      </Section>
    );
  }

  return (
    <Section title="Deliver milestones" desc="You are the assigned worker. Submit each milestone; the requester accepts (or it auto-releases after the review window).">
      <Card title="Submit milestone" hint="submitMilestone — index is the milestone slot.">
        <div className="grid grid-cols-2 gap-1">
          <Field label="index" value={idx} onChange={(e) => setIdx(e.target.value)} />
          <Field label="deliverable text → hash" value={deliver} onChange={(e) => setDeliver(e.target.value)} />
        </div>
        <Command label="Submit milestone" disabled={!account}
          onDone={() => { setDeliver(''); load(); }}
          run={() => sdk.submitMilestone(marketId, BigInt(idx), scope(deliver), account!)} />
        {milestones.length > 0 && (
          <KV rows={milestones.map((ms: any, i: number) => [`#${i} ${usdc(ms.amount)}`, MILESTONE_STATUS[Number(ms.status)] ?? String(ms.status)])} />
        )}
      </Card>
    </Section>
  );
}

/* ──────────────── Bounty: findings (any registered agent) ──────────────── */
function BountyDeliver({ sdk, account, agentId, marketId, closed }: { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; agentId: string; marketId: bigint; closed: boolean }) {
  const [deliver, setDeliver] = useState('finding-v1');
  const need = !account || !agentId;

  return (
    <Section title="Submit a finding" desc="Bounties take open submissions. Each accepted finding is paid from the pool.">
      <Card title="Submit finding" hint="submitFinding — appends a finding; the requester accepts (≥ default award), rejects, or it auto-escalates.">
        <Field label="finding text → hash" value={deliver} onChange={(e) => setDeliver(e.target.value)} />
        {closed && <p className="text-xs text-amber-600">This bounty is closed.</p>}
        {need && <p className="text-xs text-amber-600">Register your identity (banner above) first.</p>}
        <Command label="Submit finding" disabled={need || closed}
          onDone={() => setDeliver('')}
          run={() => sdk.submitFinding(marketId, BigInt(agentId || '0'), scope(deliver), account!)} />
      </Card>
    </Section>
  );
}
