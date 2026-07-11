'use client';

import { use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { useQuery, useClient, gql } from 'urql';
import { EchoMode, CONTRACTS } from '@echo/sdk';
import { useEcho } from '@/lib/sdk';
import { useAgent } from '@/lib/agent';
import { useContent } from '@/lib/content';
import { ACTIVITY_QUERY, type ActivityRow } from '@/lib/activity';
import { Section, Card, Field, TextArea, KV, Badge, Button, CARD_CLASS, TierTrack, Countdown, useNow, type TierStep } from '@/components/ui';
import { Command } from '@/components/Command';
import { Attachments } from '@/components/Attachments';
import { Receipt } from '@/components/Receipt';
import { TxModal } from '@/components/TxModal';
import { RegisterIdentityModal } from '@/components/RegisterIdentityModal';
import { IdentityBanner } from '@/components/IdentityBanner';
import { usdc, scope, short, modeName, modeBadgeTone, isZeroAddr, txLink, toUnits, MILESTONE_STATUS } from '@/lib/format';
import { getAgentMarket } from '@/lib/agentApi';

const TIER_DISPUTES_QUERY = gql`
  query TierDisputes {
    disputes { id subject target opener counter status forOpener against }
  }
`;

const JOB_STATUS = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired'];
const JOB_STATUS_CLASS = [
  'bg-sky-500/10 text-sky-400 border-sky-500/20',
  'bg-sky-500/10 text-sky-400 border-sky-500/20',
  'bg-warning/10 text-warning border-warning/20',
  'bg-success/10 text-success border-success/20',
  'bg-danger/10 text-danger border-danger/20',
  'bg-white/[0.06] text-white/40 border-white/10',
];

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

const u = (s: string | null | undefined) => (s ? `$${usdc(BigInt(s))}` : '—');
const STATUS_TONE = { active: 'success', closed: 'neutral', cancelled: 'danger' } as const;

/** Mode-specific terms rows for the KV panel. */
function termsRows(m: MarketDetail, ghostDays: number | null): [string, ReactNode][] {
  const rows: [string, ReactNode][] = [
    ['status', <Badge key="s" tone={STATUS_TONE[m.status as keyof typeof STATUS_TONE] ?? 'neutral'}>{m.status}</Badge>],
    ['requester', <Link key="req" href={`/u/${m.requester}`} className="hover:underline">{short(m.requester)}</Link>],
  ];
  if (m.mode === EchoMode.OpenMarket) {
    rows.push(['escrow', u(m.escrowTotal)]);
    rows.push(['reveal fee', m.revealFee && m.revealFee !== '0' ? u(m.revealFee) : '—']);
    rows.push(['applicants', String(m.applicantCount)]);
    rows.push(['ghost deadline', ghostDays !== null ? `${ghostDays}d after final round` : '—']);
  } else if (m.mode === EchoMode.DirectJob) {
    rows.push(['worker', isZeroAddr(m.worker ?? undefined) ? '—' : short(m.worker ?? undefined)]);
    rows.push(['escrow', u(m.escrowTotal)]);
  } else if (m.mode === EchoMode.Bounty) {
    rows.push(['pool', u(m.pool)]);
    rows.push(['default award', u(m.defaultAward)]);
  }
  return rows;
}

const TIER_NAMES = ['Reveal', 'Shortlist', 'Final', 'Ghost'];

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { sdk, account } = useEcho();
  const { agentId } = useAgent();
  const [ghostDeadline, setGhostDeadline] = useState<bigint | null>(null);
  const [agentRun, setAgentRun] = useState(false);

  // Is this an AI-agent-run market? If so, applicants MUST provide a public preview (the screener reads it).
  useEffect(() => {
    getAgentMarket(Number(id)).then((a) => setAgentRun(a.agentRun)).catch(() => {});
  }, [id]);

  // Stable variables identity — an inline literal makes urql setState during render (setstate-in-render).
  const marketVars = useMemo(() => ({ id: Number(id) }), [id]);
  const [{ data, fetching, error }] = useQuery<{ market: MarketDetail | null }>({ query: MARKET, variables: marketVars });
  const m = data?.market ?? null;

  useEffect(() => {
    if (!m || m.mode !== EchoMode.OpenMarket) return;
    sdk.getMarket(BigInt(id)).then((mk: any) => setGhostDeadline(mk.ghostDeadline ?? null)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, m?.mode]);

  const tiers = (m?.tiers ?? []).filter((t) => t && t !== '0');
  const tierSteps: TierStep[] = tiers.map((t, i) => ({ label: TIER_NAMES[i] ?? `Tier ${i + 1}`, amount: usdc(BigInt(t)) }));

  return (
    <div>
      <Link href="/apply" className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white transition">
        <ChevronLeft className="w-3.5 h-3.5" /> Find work
      </Link>
      <div className="flex items-center gap-3 mt-2 mb-1">
        <h1 className="text-2xl font-bold text-white">{m?.subject || `Market #${id}`}</h1>
        {m && <Badge tone={modeBadgeTone(m.mode)}>{modeName(m.mode)}</Badge>}
        {m && <Badge tone={STATUS_TONE[m.status as keyof typeof STATUS_TONE] ?? 'neutral'}>{m.status}</Badge>}
      </div>

      <div className="mt-4"><IdentityBanner /></div>

      {m && account && account.toLowerCase() === m.requester.toLowerCase() && (
        <div className="mt-3 rounded-md border border-teal-500/20 bg-teal-500/10 px-3 py-2 text-sm flex items-center gap-2">
          <span className="text-teal-300">You created this market — you&apos;re viewing the applicant page.</span>
          <Link href={`/hire/${id}`} className="ml-auto inline-flex items-center gap-1 text-teal-400 font-medium underline">
            Manage instead
          </Link>
        </div>
      )}

      {fetching && !m && <p className="text-sm text-white/40">Loading...</p>}
      {error && <p className="text-sm text-danger break-all">{error.message} — is the indexer running on :4000?</p>}
      {!fetching && !error && !m && <p className="text-sm text-white/40">No market #{id} in the indexer.</p>}

      {m && (
        <>
          <Section title="Details" desc="Terms for this job, from the indexer.">
            <Card title="About">
              <p className="text-sm text-white/70 whitespace-pre-wrap">{m.description || <span className="text-white/30 italic">No description provided.</span>}</p>
            </Card>
            <Card title="Terms">
              <KV rows={termsRows(m, ghostDeadline !== null ? Number(ghostDeadline) / 86400 : null)} />
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

          {m.mode === EchoMode.OpenMarket && tierSteps.length > 0 && (
            <Section title="Payout ladder" desc="What you earn as you advance through each round.">
              <div className={`${CARD_CLASS} sm:col-span-2 py-4 sm:py-6`}>
                <TierTrack steps={tierSteps} />
              </div>
            </Section>
          )}

          {m.mode === EchoMode.OpenMarket && <OpenApply sdk={sdk} account={account} agentId={agentId} marketId={BigInt(id)} closed={m.status !== 'active'} agentRun={agentRun} />}
          {m.mode === EchoMode.DirectJob && <DirectDeliver sdk={sdk} account={account} marketId={BigInt(id)} worker={m.worker} />}
          {m.mode === EchoMode.Bounty && <BountyDeliver sdk={sdk} account={account} agentId={agentId} marketId={BigInt(id)} closed={m.status !== 'active'} />}
        </>
      )}
    </div>
  );
}

/* ──────────────── Open/Reveal: apply ──────────────── */
const TIER_STATUS_NAMES = ['Applied', 'Revealed', 'Shortlist', 'Final'];

type TierJob = {
  jobId: bigint;
  arcJob: { provider: `0x${string}`; evaluator: `0x${string}`; status: number; expiredAt: bigint } | null;
  ctx: { tier: number; tierAmount: bigint; ghostDeadline: bigint } | null;
};

function OpenApply({ sdk, account, agentId, marketId, closed, agentRun }: { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; agentId: string; marketId: bigint; closed: boolean; agentRun?: boolean }) {
  const [submission, setSubmission] = useState('');
  const [preview, setPreview] = useState('');
  const [app, setApp] = useState<any>(null);
  const [appLoading, setAppLoading] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [stake, setStake] = useState<bigint | null>(null);
  const [myBody, setMyBody] = useState<string | null>(null);
  const [tierJobs, setTierJobs] = useState<TierJob[]>([]);
  const { store: storeContent, fetch: fetchContent } = useContent();
  const need = !account;

  // Stake is per-market and set by the requester at creation (0 = none). Read the real value so the
  // UI shows the actual amount — or "no stake" — instead of a hardcoded figure.
  useEffect(() => {
    sdk.marketStakeRequired(marketId).then((s) => setStake(s as bigint)).catch(() => setStake(0n));
  }, [sdk, marketId]);

  const loadApp = useCallback(async () => {
    if (!account) return;
    setAppLoading(true);
    try {
      // getApplication reverts with NotParticipant() when this wallet hasn't applied yet — treat that
      // as "no application" rather than letting the revert surface as a runtime error.
      setApp(await sdk.getApplication(marketId, account));
    } catch {
      setApp(null);
    } finally {
      setAppLoading(false);
    }
  }, [sdk, marketId, account]);

  useEffect(() => { loadApp(); }, [loadApp]);

  const applied = !!app && Number(app.appliedAt) > 0;
  const hasStake = stake !== null && stake > 0n;
  const stakeText = stake !== null && stake > 0n ? `${usdc(stake)} USDC` : null;
  const tierJobIds: bigint[] = (app?.tierJobIds ?? []) as bigint[];
  const tierJobIdsKey = tierJobIds.map((j) => j.toString()).join(',');

  // Pull the applicant's own stored application body so "Load my application" shows the actual
  // submission text (not just its hash). The content channel gates 'apply' reads to the participant
  // themselves (always) and the requester after reveal.
  useEffect(() => {
    if (!applied || !account) { setMyBody(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const row = await fetchContent(Number(marketId), 'apply', account.toLowerCase(), account);
        if (!cancelled) setMyBody(row?.body ?? null);
      } catch { if (!cancelled) setMyBody(null); }
    })();
    return () => { cancelled = true; };
  }, [applied, account, marketId, fetchContent]);

  // Once the requester reveals + grades, each advancement spawns an Arc tier job with this applicant
  // as the provider. Load those jobs so the worker gets their per-tier deliverable UI (TierJobCard) —
  // without this the applicant is advanced but has nowhere to act.
  const loadTierJobs = useCallback(async () => {
    if (!account || tierJobIds.length === 0) { setTierJobs([]); return; }
    const jobs = await Promise.all(tierJobIds.map(async (jobId) => {
      const [arcJob, ctx] = await Promise.all([
        sdk.getArcJob(jobId).catch(() => null) as Promise<TierJob['arcJob']>,
        sdk.getJobContext(jobId).catch(() => null) as Promise<TierJob['ctx']>,
      ]);
      return { jobId, arcJob, ctx };
    }));
    setTierJobs(jobs);
  }, [sdk, account, tierJobIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadTierJobs(); }, [loadTierJobs]);

  return (
    <Section title="Apply" desc="Submit your application. The requester reveals, grades, and advances applicants through tiers.">
      <div className="sm:col-span-2 space-y-3">
        {applied ? (
          <div className="rounded-xl border border-success/20 bg-success/[0.06] px-4 py-3 text-sm">
            <span className="inline-flex items-center gap-1.5 font-semibold text-success">
              <CheckCircle2 className="w-4 h-4" /> Application submitted
            </span>
            {hasStake ? (
              <span className="text-white/60"> Your {stakeText} stake is <b className="text-white/80">held</b> (not spent) — refunded in full if you withdraw before being revealed, forfeited only if you&apos;re revealed and then fail to deliver.</span>
            ) : (
              <span className="text-white/60"> No stake was required for this market.</span>
            )}
            <span className="block text-xs text-white/40 mt-1">Payouts land as the requester accepts each tier — track every on-chain movement on the <Link href="/activity" className="underline hover:text-white">Activity</Link> page.</span>
          </div>
        ) : stake === null ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/50">
            Checking the stake requirement for this market…
          </div>
        ) : hasStake ? (
          <div className="rounded-xl border border-warning/20 bg-warning/[0.06] px-4 py-3 text-sm text-white/70">
            <b className="font-semibold text-white">{stakeText} stake required to apply.</b> It is held until you are revealed.
            Withdraw before being revealed and the full stake is refunded. Get revealed and fail to deliver, and the
            stake is forfeited to cover the requester&apos;s review cost.
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/60">
            <b className="font-semibold text-white">No stake required</b> to apply for this market. You can submit your application directly.
          </div>
        )}

        {applied ? (
          <Card title="Your application">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
              <span className="text-sm font-semibold text-white">Application submitted</span>
            </div>
            <KV rows={[
              ['submission hash', short(app.submissionHash)],
              ['tier status', TIER_STATUS_NAMES[Number(app.tierReached)] ?? `Tier ${app.tierReached}`],
            ]} />
            <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">Your submission</div>
              {myBody !== null
                ? <p className="text-sm text-white/70 whitespace-pre-wrap">{myBody}</p>
                : <p className="text-xs text-white/40 italic">Body isn&apos;t stored for this application (applied before the content channel, or from another device). Only its hash is on-chain.</p>}
            </div>
            {account && (
              <Attachments marketId={Number(marketId)} kind="apply" contentKey={account.toLowerCase()} account={account}
                canEdit={!closed} label="Your files" />
            )}
            <Button variant="secondary" busy={appLoading} onClick={() => { loadApp(); }}>Load my application</Button>
          </Card>
        ) : (
          <Card title="Apply to this market" hint="Mints a participation receipt; pulls the stake if the market requires one.">
            <Field label="submission text → hash" value={submission} onChange={(e) => setSubmission(e.target.value)} />
            {/* Public preview: the applicant's opt-in teaser. Optional normally; REQUIRED on agent-run
                markets, where the AI screener reads it (free) to decide who to pay to reveal (#4). */}
            <TextArea
              label={agentRun ? 'public preview — required (the AI screener reads this to decide whether to reveal you)' : 'public preview (optional pitch, visible to everyone)'}
              value={preview}
              onChange={(e) => setPreview(e.target.value)}
              placeholder="A short public pitch: what you'd deliver and why you're a fit. Your full submission stays private until revealed."
              rows={3}
            />
            {account && (
              <Attachments marketId={Number(marketId)} kind="apply" contentKey={account.toLowerCase()} account={account}
                canEdit={!closed} label="Attach files to your application (optional)" />
            )}
            {closed && <p className="text-xs text-warning">This market is no longer active.</p>}
            {!account && <p className="text-xs text-warning">Connect a wallet to apply.</p>}
            {agentRun && !preview.trim() && <p className="text-xs text-warning">This market is screened by an AI agent — a public preview is required to apply.</p>}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => (agentId ? setApplyOpen(true) : setIdentityOpen(true))}
                disabled={need || closed || (agentRun && !preview.trim())}
              >
                {hasStake ? `Apply, pay ${stakeText} stake` : 'Apply'}
              </Button>
              <Command label="Load my application" tone="neutral" disabled={!account} onDone={() => loadApp()}
                run={async () => { try { setApp(await sdk.getApplication(marketId, account!)); } catch { setApp(null); } return 'loaded'; }} />
            </div>
          </Card>
        )}

        {/* #9/#12: once revealed + graded, each tier is an Arc job with this applicant as provider.
            Show what stage they're at and surface the deliverable UI for any open tier job — without
            this, an advanced applicant sees "Final" with nothing to do. */}
        {applied && account && (
          <WorkerTierProgress
            tierReached={Number(app.tierReached)}
            revealFeePending={Number(app.tierReached) === 0}
            jobs={tierJobs}
            sdk={sdk}
            account={account}
            marketId={marketId}
            onChanged={() => { loadApp(); loadTierJobs(); }}
          />
        )}

        {applyOpen && (
          <TxModal
            title="Apply to this market"
            description={hasStake
              ? `This pulls your ${stakeText} stake into the market escrow. It is refunded if you withdraw before being revealed.`
              : 'This market requires no stake — applying just mints your participation receipt.'}
            confirmLabel={hasStake ? `Apply, pay ${stakeText} stake` : 'Apply'}
            run={async () => {
              const stake = await sdk.marketStakeRequired(marketId).catch(() => 0n);
              if (stake > 0n) await sdk.ensureUsdcAllowance(C.marketRegistry, stake, account!);
              const hash = await sdk.applyToMarket(marketId, BigInt(agentId || '0'), scope(submission), account!);
              // Store the application body off-chain (only its hash goes on-chain) so the applicant can
              // reload it and the requester can read it after paying the reveal fee. Also store the
              // public preview (if given) so the AI screener can read it. Keyed by the participant's own
              // address; best-effort so a content-channel hiccup doesn't fail the apply.
              try {
                await storeContent(Number(marketId), 'apply', account!.toLowerCase(), submission.trim(), account!);
                if (preview.trim()) {
                  await storeContent(Number(marketId), 'preview', account!.toLowerCase(), preview.trim(), account!);
                }
              } catch { /* body storage is best-effort; the on-chain apply already succeeded */ }
              return hash;
            }}
            onClose={() => setApplyOpen(false)}
            onDone={() => loadApp()}
          />
        )}
        {identityOpen && <RegisterIdentityModal onClose={() => setIdentityOpen(false)} onRegistered={() => { setIdentityOpen(false); setApplyOpen(true); }} />}
      </div>
    </Section>
  );
}

/**
 * #9/#12 — the applicant's view of where they stand and what to do next. Reveal/grade/advance are all
 * requester-driven, so between actions the worker is genuinely just waiting; the confusion was that the
 * UI said nothing. This makes the wait explicit and surfaces the deliverable UI the moment a tier job
 * opens for them.
 */
function WorkerTierProgress({ tierReached, revealFeePending, jobs, sdk, account, marketId, onChanged }: {
  tierReached: number; revealFeePending: boolean; jobs: TierJob[];
  sdk: ReturnType<typeof useEcho>['sdk']; account: `0x${string}`; marketId: bigint; onChanged: () => void;
}) {
  const stageLabel = TIER_STATUS_NAMES[tierReached] ?? `Tier ${tierReached}`;
  // Is any tier job currently waiting on THIS worker to submit (Arc status Open === 0, provider = me)?
  const awaitingMe = jobs.some((j) => (j.arcJob?.status ?? -1) === 0 && j.arcJob?.provider.toLowerCase() === account.toLowerCase());

  // Live ghost-deadline headline: once at Final, the ghost clock is running. Fetch the same value the
  // tier card uses (sdk.ghostDeadline of the Final job) so the two never disagree.
  const finalJob = jobs.find((j) => (j.ctx?.tier ?? -1) === 3);
  const [ghostAt, setGhostAt] = useState<number>(0);
  const now = useNow(1000);
  useEffect(() => {
    if (!finalJob) { setGhostAt(0); return; }
    let cancelled = false;
    sdk.ghostDeadline(finalJob.jobId).then((d) => { if (!cancelled) setGhostAt(Number(d)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [sdk, finalJob?.jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card title="Your progress">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-white/50">Current stage:</span>
        <Badge tone={tierReached === 3 ? 'success' : 'neutral'}>{stageLabel}</Badge>
      </div>

      {ghostAt > 0 && (
        <div className={`mt-2 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${now >= ghostAt ? 'border-danger/30 bg-danger/[0.06] text-danger' : 'border-warning/30 bg-warning/[0.06] text-warning'}`}>
          <Countdown targetTs={ghostAt} prefix="Ghost deadline in" passedText="Ghost deadline passed — the requester can trigger the penalty" />
          <span className="text-white/30 hidden sm:inline">· {new Date(ghostAt * 1000).toLocaleString()}</span>
        </div>
      )}

      {/* What's happening / what to do — the requester drives reveal + grading, so most stages are a wait. */}
      {revealFeePending ? (
        <p className="text-xs text-white/50 mt-2">
          You&apos;ve applied. The requester pays a reveal fee to unlock your submission, then grades and
          advances applicants tier by tier. <b className="text-white/70">Nothing is required from you right now</b> —
          you&apos;ll get a deliverable to submit here if you&apos;re advanced to a paid tier.
        </p>
      ) : awaitingMe ? (
        <p className="text-xs text-teal-300 mt-2">
          You&apos;ve been advanced — <b>submit your deliverable</b> for the open tier job below to get paid.
        </p>
      ) : (
        <p className="text-xs text-white/50 mt-2">
          You&apos;ve been revealed/advanced. When the requester opens the next tier, a deliverable box appears
          below. If a job shows <b className="text-white/70">Submitted</b>, you&apos;re waiting on the requester to
          accept and release payment.
        </p>
      )}

      {jobs.length > 0 && (
        <div className="mt-3 space-y-3">
          {jobs.map((job) => (
            <TierJobCard key={job.jobId.toString()} sdk={sdk} account={account} marketId={marketId} job={job} onChanged={onChanged} />
          ))}
        </div>
      )}
    </Card>
  );
}

function TierJobCard({ sdk, account, marketId, job, onChanged }: {
  sdk: ReturnType<typeof useEcho>['sdk']; account: `0x${string}`; marketId: bigint;
  job: TierJob; onChanged: () => void;
}) {
  const now = useNow(1000);
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
            push out); the Arc job's own expiredAt can drift from it, so prefer ghostDeadline here.
            Live countdown beside the absolute time so the worker sees the pressure tick down. */}
        {(() => {
          const isFinal = tier === 3 && ghostDeadline > 0n;
          const targetTs = isFinal ? Number(ghostDeadline) : expiredAt > 0n ? Number(expiredAt) : 0;
          if (targetTs === 0) return null;
          const past = now >= targetTs;
          return (
            <span className={`text-xs flex items-center gap-1.5 flex-wrap ${past ? 'text-danger' : 'text-warning'}`}>
              <Countdown
                targetTs={targetTs}
                prefix={isFinal ? 'ghosts in' : 'expires in'}
                passedText={isFinal ? 'ghost deadline passed' : 'expired'}
              />
              <span className="text-white/30">· {new Date(targetTs * 1000).toLocaleString()}</span>
            </span>
          );
        })()}
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
          <Attachments marketId={Number(marketId)} kind="deliver" contentKey={job.jobId.toString()} account={account}
            canEdit label="Deliverable files (optional) — attach before you submit" />
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
      {(status === 2 || status === 3) && isProvider && (
        <Attachments marketId={Number(marketId)} kind="deliver" contentKey={job.jobId.toString()} account={account} label="Submitted files" />
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
          <p className="text-sm text-white/50 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-white/30" />
            This direct job is assigned to {isZeroAddr(worker ?? undefined) ? 'an unset address' : short(worker ?? undefined)}.
            {account ? ' Your connected wallet is not the worker.' : ' Connect the worker wallet to submit milestones.'}
          </p>
        </Card>
      </Section>
    );
  }

  return (
    <Section title="Deliver milestones" desc="You are the assigned worker. Submit each milestone; the requester accepts (or it auto-releases after the review window).">
      <Card title="Submit milestone" hint="Index is the milestone slot.">
        <div className="grid grid-cols-2 gap-1">
          <Field label="index" value={idx} onChange={(e) => setIdx(e.target.value)} />
          <Field label="deliverable text → hash" value={deliver} onChange={(e) => setDeliver(e.target.value)} />
        </div>
        <Command label="Submit milestone" disabled={!account}
          onDone={() => { setDeliver(''); load(); }}
          run={() => sdk.submitMilestone(marketId, BigInt(idx), scope(deliver), account!)} />
        {milestones.length > 0 && (
          <KV rows={milestones.map((ms: any, i: number) => [`#${i} $${usdc(ms.amount)}`, MILESTONE_STATUS[Number(ms.status)] ?? String(ms.status)])} />
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
      <Card title="Submit finding" hint="Appends a finding; the requester accepts, rejects, or it auto-escalates.">
        <Field label="finding text → hash" value={deliver} onChange={(e) => setDeliver(e.target.value)} />
        {closed && <p className="text-xs text-warning">This bounty is closed.</p>}
        {need && <p className="text-xs text-warning">Register your identity (banner above) first.</p>}
        <Command label="Submit finding" disabled={need || closed}
          onDone={() => setDeliver('')}
          run={() => sdk.submitFinding(marketId, BigInt(agentId || '0'), scope(deliver), account!)} />
      </Card>
    </Section>
  );
}
