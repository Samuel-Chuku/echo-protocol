'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronUp, ChevronDown, ExternalLink, Clock, Ghost, MessageSquare, Star, Lock } from 'lucide-react';
import { useQuery, gql } from 'urql';
import { EchoMode, CONTRACTS } from '@echo/sdk';
import { useEcho } from '@/lib/sdk';
import { useContent } from '@/lib/content';
import { useFlag } from '@/lib/flags';
import { Section, Card, Field, TextArea, KV, Badge, Button, EmptyState, CARD_CLASS } from '@/components/ui';
import { Command } from '@/components/Command';
import { TxModal } from '@/components/TxModal';
import { TierAdvanceModal } from '@/components/TierAdvanceModal';
import { GhostPenaltyModal } from '@/components/GhostPenaltyModal';
import { usdc, scope, toUnits, short, modeName, modeBadgeTone, txLink, duration, FINDING_STATUS, MILESTONE_STATUS } from '@/lib/format';
import { eventLabel, summarizeArgs, timeAgo, type ActivityRow } from '@/lib/activity';

type PayoutSummary = {
  total: bigint;
  perTier: Map<number, bigint>;
  ghostSlashed: bigint;
};

const HOOK_TIER_LABELS: Record<number, string> = {
  0: 'Submitted', 1: 'Substantive', 2: 'Shortlist', 3: 'Final', 4: 'Ghost', 5: 'Milestone', 6: 'Finding',
};

// Arc JobStatus pills — dark-theme variants matching the redesign palette.
const JOB_STATUS = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired'];
const JOB_STATUS_CLASS = [
  'bg-teal-500/10 text-teal-300 border-teal-500/20',
  'bg-teal-500/10 text-teal-300 border-teal-500/20',
  'bg-warning/10 text-warning border-warning/20',
  'bg-success/10 text-success border-success/20',
  'bg-danger/10 text-danger border-danger/20',
  'bg-white/5 text-white/40 border-white/10',
];

const C = CONTRACTS.arcTestnet;

/**
 * Per-market management (#12). Loads one market by route id and drives its lifecycle, gated by mode:
 * Open/Reveal applicant list + grading, Direct-Job milestones, Bounty findings. Attribution funding is
 * an explicit opt-in step with an explainer (#9), not always-on.
 */
type Loaded = {
  mode: number;
  market: any;
  remaining: bigint;
  apps: any[];
  findings: any[];
  milestones: any[];
  revealFee: bigint;
  flagWindow: bigint;
  ghostDeadline: bigint;
};

const MARKET_ACTIVITY = gql`
  query MarketActivity($marketId: Int!) {
    marketActivity(marketId: $marketId, limit: 200) {
      id blockNumber txHash eventName marketId actor args state createdAt
    }
  }
`;

const TIER_LABELS = ['Applied', 'Revealed', 'Shortlist', 'Final'];

export default function ManageMarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { sdk, account } = useEcho();
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [ghostResult, setGhostResult] = useState<{ recipient: string; amount: string; paid: boolean } | null>(null);

  const marketId = () => BigInt(id || '0');

  // Requester-only actions (Close market, grading, ghost) revert for anyone else on-chain, so we
  // hide them from non-requesters (e.g. a worker viewing their own market page).
  const isRequester =
    !!account && !!data?.market?.requester && account.toLowerCase() === data.market.requester.toLowerCase();

  // A closed market is terminal: escrow has been returned and every on-chain write (grade, ghost,
  // settle, close, attribution funding) reverts. When closed we drop all action affordances and keep
  // the page read-only — status, applicant results, timeline, and feedback.
  const isClosed = !!data?.market?.closed;

  // Single source of truth for marketActivity rows — used by both the Timeline AND the per-applicant
  // payout rollup (so we only hit the indexer once per refresh).
  const [{ data: actData, fetching: actFetching }, refetchActivity] = useQuery<{ marketActivity: ActivityRow[] }>({
    query: MARKET_ACTIVITY,
    variables: { marketId: Number(id) },
    requestPolicy: 'cache-and-network',
  });
  const activityRows = actData?.marketActivity ?? [];

  // Bump = whenever a contract action just resolved (data changes) → chase the indexer with two
  // retries because event propagation has a few-second tail.
  useEffect(() => {
    if (!data?.market) return;
    const t1 = setTimeout(() => refetchActivity({ requestPolicy: 'network-only' }), 2500);
    const t2 = setTimeout(() => refetchActivity({ requestPolicy: 'network-only' }), 7000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [data?.market, refetchActivity]);

  // Per-participant rollup of TierPayout (net earned) + GhostPenalty (slashed) from indexer events.
  // Addresses normalised to lowercase since the indexer stores `actor` lowercased.
  const payouts = useMemo(() => {
    const m = new Map<string, PayoutSummary>();
    for (const r of activityRows) {
      if (r.eventName !== 'TierPayout' && r.eventName !== 'GhostPenalty') continue;
      let args: Record<string, unknown>;
      try { args = JSON.parse(r.args); } catch { continue; }
      const who = String(args.provider ?? '').toLowerCase();
      if (!who.startsWith('0x')) continue;
      const e = m.get(who) ?? { total: 0n, perTier: new Map<number, bigint>(), ghostSlashed: 0n };
      if (r.eventName === 'TierPayout') {
        const tier = Number(args.tier ?? 0);
        // Indexer stores the payout under `args.amount` (reducers.ts: TierPayout → args.amount).
        const net = BigInt(String(args.amount ?? '0'));
        e.total += net;
        e.perTier.set(tier, (e.perTier.get(tier) ?? 0n) + net);
      } else {
        // GhostPenalty amount is likewise `args.amount`, not `args.ghostAmount`.
        e.ghostSlashed += BigInt(String(args.amount ?? '0'));
      }
      m.set(who, e);
    }
    return m;
  }, [activityRows]);

  // When was each applicant revealed? Derived from indexed `Revealed` events so the UI can show
  // "Flag window elapses in 1d 4h" / "Settle ready" on the stake row without an extra contract
  // read. The map is participant-lowercased → unix seconds.
  const revealedAtMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of activityRows) {
      if (r.eventName !== 'Revealed') continue;
      let args: Record<string, unknown>;
      try { args = JSON.parse(r.args); } catch { continue; }
      const who = String(args.participant ?? '').toLowerCase();
      if (!who.startsWith('0x')) continue;
      // First Revealed event wins (re-reveal isn't a thing on-chain, but be defensive).
      if (!m.has(who)) m.set(who, r.createdAt);
    }
    return m;
  }, [activityRows]);

  async function load() {
    setErr('');
    try {
      const mid = marketId();
      const mode = Number(await sdk.marketMode(mid));
      const [market, remaining, revealFee, flagWindow, stakeRequired] = await Promise.all([
        sdk.getMarket(mid),
        sdk.remainingEscrow(mid).catch(() => 0n),
        sdk.revealFee(mid).catch(() => 0n),
        sdk.revealFlagWindow(mid).catch(() => 0n),
        sdk.marketStakeRequired(mid).catch(() => 0n),
      ]);
      const apps = mode === EchoMode.OpenMarket ? ((await sdk.getMarketApplications(mid)) as any[]) : [];
      const findings = mode === EchoMode.Bounty ? ((await sdk.getBountyFindings(mid)) as any[]) : [];
      const milestones = mode === EchoMode.DirectJob ? ((await sdk.getDirectJobMilestones(mid)) as any[]) : [];
      setData({
        mode, market, remaining: remaining as bigint, apps, findings, milestones,
        revealFee: revealFee as bigint, flagWindow: flagWindow as bigint,
        ghostDeadline: (market as any).ghostDeadline ?? 0n,
      });
    } catch (e: any) {
      setData(null);
      setErr(e?.shortMessage || e?.message || String(e));
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <Link href="/hire" className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white transition">
          <ChevronLeft className="w-3.5 h-3.5" /> My markets
        </Link>
        <Link href="/disputes" className="text-xs text-white/40 hover:text-white transition">Disputes →</Link>
      </div>
      <div className="flex items-center gap-3 mt-2 mb-1">
        <h1 className="text-2xl font-bold text-white">Market #{id}</h1>
        {data && <Badge tone={modeBadgeTone(data.mode)}>{modeName(data.mode)}</Badge>}
        {data && <Badge tone={data.market?.closed ? 'neutral' : 'success'}>{data.market?.closed ? 'closed' : 'active'}</Badge>}
      </div>
      <p className="text-sm text-white/50 mb-6">{data ? '' : 'Loading…'}{data?.market?.subject ? data.market.subject : ''}</p>

      <Section title="Status" desc="Live on-chain state for this market.">
        <Card title="Overview">
          <Command label="Refresh" tone="neutral" run={async () => { await load(); return 'refreshed'; }} />
          {err && <p className="text-xs text-danger break-all">{err}</p>}
          {data && (
            <KV rows={[
              ['requester', short(data.market?.requester)],
              ['escrow remaining', `$${usdc(data.remaining)}`],
              ['reveal fee', data.revealFee ? `$${usdc(data.revealFee)}` : '—'],
              ['flag window', data.flagWindow ? duration(Number(data.flagWindow)) : '—'],
              ['ghost deadline', data.ghostDeadline ? `${duration(Number(data.ghostDeadline))} after final round` : '—'],
              ['applicants', String(data.market?.applicantCount ?? '—')],
            ]} />
          )}
        </Card>

        {isClosed && (
          <div className="sm:col-span-2 flex items-start gap-3 rounded-card border border-white/10 bg-white/[0.03] p-4">
            <Lock className="w-4 h-4 text-white/40 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-white">Market closed</h3>
              <p className="text-xs text-white/50 mt-0.5">
                This market has been closed and settled — any unspent escrow was returned to you. No
                further on-chain actions can be taken. Everything below is read-only; you can still
                review the timeline and leave feedback.
              </p>
            </div>
          </div>
        )}

        {data?.mode === EchoMode.OpenMarket && (
          <div className="sm:col-span-2 space-y-3">
            <ApplicantList sdk={sdk} account={account} data={data} marketId={marketId()} onChanged={load} onGhost={setGhostResult} closed={isClosed} />
            {!isClosed && (
              <div className={CARD_CLASS}>
                <h3 className="text-sm font-semibold text-white">Close market</h3>
                <p className="text-xs text-white/40 mt-0.5">Returns unspent USDC to you. A reveal market needs its minimum-reveal floor met first.</p>
                <Button variant="danger" className="mt-3" onClick={() => setCloseOpen(true)}>Close market</Button>
              </div>
            )}
          </div>
        )}

        {/* Direct Job actions */}
        {data?.mode === EchoMode.DirectJob && (
          <DirectJobActions sdk={sdk} account={account} data={data} marketId={marketId()} onChanged={load} closed={isClosed} />
        )}

        {/* Bounty actions */}
        {data?.mode === EchoMode.Bounty && (
          <BountyActions sdk={sdk} account={account} data={data} marketId={marketId()} onChanged={load} closed={isClosed} />
        )}
      </Section>

      <MarketTimeline rows={activityRows} fetching={actFetching} onRefresh={() => refetchActivity({ requestPolicy: 'network-only' })} />

      <AttributionOptIn sdk={sdk} account={account} marketId={marketId} closed={isClosed} />
      <FeedbackPreview />

      {closeOpen && (
        <TxModal
          title="Close market"
          description="Closes the market and returns any unspent escrow to your wallet."
          confirmLabel="Close market"
          run={() => sdk.closeMarket(marketId(), account!)}
          onClose={() => setCloseOpen(false)}
          onDone={load}
        />
      )}
      {ghostResult && <GhostPenaltyModal recipient={ghostResult.recipient} amount={ghostResult.amount} paid={ghostResult.paid} onClose={() => setGhostResult(null)} />}
    </div>
  );
}

/* ──────────────────────────── per-market timeline ──────────────────────────── */

function MarketTimeline({ rows, fetching, onRefresh }: { rows: ActivityRow[]; fetching: boolean; onRefresh: () => void }) {
  const now = Math.floor(Date.now() / 1000);
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const sorted = useMemo(() => (order === 'desc' ? [...rows].reverse() : rows), [rows, order]);
  return (
    <Section title="Timeline" desc={`Every on-chain event for this market, ${order === 'desc' ? 'newest first' : 'oldest first'}.`}>
      <div className="sm:col-span-2">
        <Card title="What's happened">
          <div className="flex items-center justify-end gap-3 -mt-1 mb-1">
            <button
              onClick={() => setOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
              className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white transition"
              title={order === 'desc' ? 'Show oldest first' : 'Show newest first'}
            >
              {order === 'desc' ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              {order === 'desc' ? 'Newest first' : 'Oldest first'}
            </button>
            <button onClick={onRefresh} className="text-xs text-white/30 hover:text-white underline transition">Refresh</button>
          </div>
          {fetching && sorted.length === 0 && <p className="text-xs text-white/40">Loading…</p>}
          {!fetching && sorted.length === 0 && <p className="text-xs text-white/40">No events yet.</p>}
          {sorted.length > 0 && (
            <ol className="relative border-l border-white/10 ml-2 space-y-3">
              {sorted.map((r) => (
                <li key={r.id} className="ml-4">
                  <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-teal-500 border border-ink" />
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-white">{eventLabel(r.eventName)}</span>
                        <span className="text-[10px] text-white/40 tabular-nums">{timeAgo(r.createdAt, now)} · block {r.blockNumber}</span>
                      </div>
                      <div className="text-xs text-white/50 font-mono mt-0.5 truncate">{summarizeArgs(r.args)}</div>
                    </div>
                    <a href={txLink(r.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-white/30 hover:text-white shrink-0 transition">
                      Tx: <span className="font-mono">{short(r.txHash)}</span> <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </Section>
  );
}

/* ──────────────────────────── Open/Reveal applicant list ──────────────────────────── */

function ApplicantList({
  sdk, account, data, marketId, onChanged, onGhost, closed,
}: {
  sdk: ReturnType<typeof useEcho>['sdk'];
  account?: `0x${string}`;
  data: Loaded;
  marketId: bigint;
  onChanged: () => void;
  onGhost: (r: { recipient: string; amount: string; paid: boolean }) => void;
  /** When the market is closed, the list is read-only: results stay, all action controls hide. */
  closed: boolean;
}) {
  const [advance, setAdvance] = useState<{ participant: string; fromLabel: string; toLabel: string; amount: string; paysNow: boolean; run: () => Promise<unknown> } | null>(null);
  const apps = data.apps ?? [];
  const tierAmounts: bigint[] = data.market?.tierAmounts ?? [];
  const ghostAmount = tierAmounts[3] !== undefined ? usdc(tierAmounts[3]) : '0';
  const now = Math.floor(Date.now() / 1000);
  // Tier-job accept/reject/revision + deliverable reads are the evaluator's tools — requester-only.
  const isRequester =
    !!account && !!data.market?.requester && account.toLowerCase() === data.market.requester.toLowerCase();

  // Real per-job ghost deadlines. The contract starts the Final job's ghost clock at grade-to-Final
  // time (MarketRegistry._createTierJob), NOT at apply time — so read sdk.ghostDeadline(finalJobId)
  // for each tier-3 applicant. Keyed by participant → unix seconds; falls back to an estimate below.
  const [ghostDeadlines, setGhostDeadlines] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const finalists = apps.filter((a: any) => Number(a.tierReached) === 3 && (a.tierJobIds ?? []).length > 0);
    if (finalists.length === 0) { setGhostDeadlines(new Map()); return; }
    (async () => {
      const entries = await Promise.all(finalists.map(async (a: any) => {
        const ids = a.tierJobIds as bigint[];
        const finalJobId = ids[ids.length - 1];
        const dl = await sdk.ghostDeadline(finalJobId).catch(() => 0n);
        return [a.participant as string, Number(dl)] as const;
      }));
      if (!cancelled) setGhostDeadlines(new Map(entries.filter(([, v]) => v > 0)));
    })();
    return () => { cancelled = true; };
  }, [sdk, apps]);

  function nextAction(a: any) {
    const t = Number(a.tierReached);
    if (t === 0) {
      // Reveal pays the fee atomically (echoHook.settleReveal). Grade* only spawn a tier job — the
      // payout fires later when the worker submits and the requester accepts, so paysNow is false.
      return data.revealFee > 0n
        ? { label: 'Reveal', toLabel: 'Revealed', amount: usdc(data.revealFee), paysNow: true, run: () => sdk.reveal(marketId, a.participant, account!) }
        : { label: 'Grade Substantive', toLabel: 'Revealed', amount: usdc(tierAmounts[0] ?? 0n), paysNow: false, run: () => sdk.gradeSubstantive(marketId, a.participant, account!) };
    }
    if (t === 1) return { label: 'Advance', toLabel: 'Shortlist', amount: usdc(tierAmounts[1] ?? 0n), paysNow: false, run: () => sdk.gradeShortlist(marketId, a.participant, account!) };
    if (t === 2) return { label: 'Advance', toLabel: 'Final', amount: usdc(tierAmounts[2] ?? 0n), paysNow: false, run: () => sdk.gradeFinal(marketId, a.participant, account!) };
    return null;
  }

  if (apps.length === 0) {
    return (
      <div className={CARD_CLASS}>
        <EmptyState icon={Clock} title="No applicants yet" desc="Once workers apply, they'll show up here for you to reveal and advance." />
      </div>
    );
  }

  return (
    <div className={CARD_CLASS}>
      <h3 className="text-sm font-semibold text-white mb-1">Applicants</h3>
      <ul className="divide-y divide-white/[0.08]">
        {apps.map((a: any) => {
          const t = Number(a.tierReached);
          const next = nextAction(a);
          const realGhostDeadline = ghostDeadlines.get(a.participant) ?? null;
          const estGhostDeadline = t === 3 && data.ghostDeadline ? Number(a.appliedAt) + Number(data.ghostDeadline) : null;
          const ghostDeadline = realGhostDeadline ?? estGhostDeadline;
          const ghostIsReal = realGhostDeadline !== null;
          const ghostPassed = ghostDeadline !== null && now > ghostDeadline;

          const tierJobIds = (a.tierJobIds ?? []) as bigint[];

          return (
            <li key={a.participant} className="py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm text-white">{short(a.participant)}</span>
                <Badge tone={t === 3 ? 'success' : 'neutral'}>{TIER_LABELS[t] ?? `tier ${t}`}</Badge>
                <span className="text-xs text-white/30 font-mono truncate max-w-[10rem]" title={a.submissionHash}>
                  {a.submissionHash}
                </span>

                {t === 3 && ghostDeadline !== null && (
                  <span className={`text-xs flex items-center gap-1 ${ghostPassed ? 'text-danger' : 'text-warning'}`}>
                    <Clock className="w-3 h-3" />
                    {ghostPassed
                      ? `Ghost deadline passed${ghostIsReal ? '' : ' (est.)'}`
                      : `~${Math.max(0, Math.ceil((ghostDeadline - now) / 86400))}d to ghost deadline${ghostIsReal ? '' : ' (est.)'}`}
                  </span>
                )}

                {!closed && (
                <span className="ml-auto flex items-center gap-2">
                  {next && (
                    <Button
                      variant="secondary"
                      onClick={() => setAdvance({ participant: a.participant, fromLabel: TIER_LABELS[t], toLabel: next.toLabel, amount: next.amount, paysNow: next.paysNow, run: next.run })}
                    >
                      {next.label}
                    </Button>
                  )}
                  {t >= 1 && data.revealFee > 0n && (
                    <Command label="Settle stake" tone="neutral" disabled={!account}
                      run={() => sdk.settleRevealStake(marketId, a.participant, account!)} onDone={onChanged} />
                  )}
                  {t === 3 && (
                    <Command
                      label="Trigger ghost"
                      tone="neutral"
                      disabled={!account}
                      run={async () => {
                        // Which branch fires depends on the Final job's Arc status at the deadline:
                        //   Submitted/Funded → full ghost reserve pays the worker (job.provider)
                        //   Open (never delivered) → worker slashed, NO USDC moves (WorkerGhosted)
                        // Read the status BEFORE triggering so the receipt modal reports the truth.
                        const finalJobId = tierJobIds.length > 0 ? tierJobIds[tierJobIds.length - 1] : null;
                        let paid = false;
                        if (finalJobId !== null) {
                          const j = await sdk.getArcJob(finalJobId).catch(() => null) as { status: number } | null;
                          paid = !!j && (Number(j.status) === 1 || Number(j.status) === 2);
                        }
                        await sdk.triggerGhost(marketId, a.participant, account!);
                        onGhost({ recipient: a.participant, amount: ghostAmount, paid });
                        return 'done';
                      }}
                      onDone={onChanged}
                    />
                  )}
                </span>
                )}
              </div>

              {/* Requester-only tier-job evaluation: accept & pay, Final reject, request revision, read
                  deliverables. Hidden once closed — those writes revert on a settled market. */}
              {isRequester && !closed && tierJobIds.length > 0 && (
                <ApplicantTierJobs sdk={sdk} account={account!} marketId={marketId} tierJobIds={tierJobIds} onDone={onChanged} />
              )}
            </li>
          );
        })}
      </ul>

      {!closed && (
        <p className="mt-2 text-xs text-white/30">
          Flag a revealed applicant as bait-and-switch instead of advancing them by opening a{' '}
          <Link href="/disputes" className="underline hover:text-white">bonded stake dispute</Link>.
        </p>
      )}

      {advance && (
        <TierAdvanceModal
          participant={advance.participant}
          fromLabel={advance.fromLabel}
          toLabel={advance.toLabel}
          amount={advance.amount}
          paysNow={advance.paysNow}
          run={advance.run}
          onClose={() => setAdvance(null)}
          onDone={onChanged}
        />
      )}
    </div>
  );
}

/** Lazy-fetch + render a content blob from the indexer. Signs once on click — the indexer
 *  enforces gating (apply: requester after reveal; deliver: provider or evaluator of the Arc job). */
function ContentView({ marketId, kind, contentKey, viewer }: {
  marketId: number; kind: 'apply' | 'deliver' | 'reject'; contentKey: string; viewer: `0x${string}`;
}) {
  const { fetch: fetchContent } = useContent();
  const [body, setBody] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(null);
    (async () => {
      try {
        const row = await fetchContent(marketId, kind, contentKey, viewer);
        if (!cancelled) setBody(row?.body ?? null);
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to read content');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [marketId, kind, contentKey, viewer, fetchContent]);

  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">
        {kind === 'apply' ? 'Application body' : kind === 'reject' ? 'Reject reason' : 'Deliverable body'}
      </div>
      {loading && <p className="text-xs text-white/40">Loading… (sign to authorize read)</p>}
      {err && <p className="text-xs text-danger break-all">{err}</p>}
      {!loading && !err && body === null && <p className="text-xs text-white/40 italic">No body stored.</p>}
      {!loading && body !== null && <p className="text-sm text-white/70 whitespace-pre-wrap">{body}</p>}
    </div>
  );
}

/** Requester's tier-job evaluation panel: read the deliverable, then Accept & pay, Request revision,
 *  or (Final tier only) Reject. `web.hideReject` hides the Reject control when the operator flips it. */
function ApplicantTierJobs({ sdk, account, marketId, tierJobIds, onDone }: {
  sdk: ReturnType<typeof useEcho>['sdk']; account: `0x${string}`; marketId: bigint;
  tierJobIds: bigint[]; onDone: () => void;
}) {
  type Job = { jobId: bigint; status: number; tier: number; tierAmount: bigint; revisionUsed: boolean };
  const [jobs, setJobs] = useState<Job[]>([]);
  const [rejectReason, setRejectReason] = useState('');
  const hideReject = useFlag('web.hideReject');
  const { store } = useContent();
  const idsKey = tierJobIds.map((j) => j.toString()).join(',');

  const load = useCallback(async () => {
    if (tierJobIds.length === 0) { setJobs([]); return; }
    const rows = await Promise.all(tierJobIds.map(async (jobId) => {
      const [arcJob, ctx, rev] = await Promise.all([
        sdk.getArcJob(jobId).catch(() => null) as Promise<{ status: number } | null>,
        sdk.getJobContext(jobId).catch(() => null) as Promise<{ tier: number; tierAmount: bigint } | null>,
        sdk.revisionInfo(jobId).catch(() => ({ used: false, extensions: 0 })),
      ]);
      return {
        jobId, status: arcJob?.status ?? 0, tier: ctx?.tier ?? 0, tierAmount: ctx?.tierAmount ?? 0n,
        revisionUsed: rev.used,
      };
    }));
    setJobs(rows);
  }, [sdk, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-white/40">Tier jobs</div>
      {jobs.length === 0 && <p className="text-xs text-white/40">Loading…</p>}
      {jobs.map((j) => (
        <div key={j.jobId.toString()} className="border-t border-white/[0.08] first:border-0 pt-2 first:pt-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="font-medium text-white/80">{HOOK_TIER_LABELS[j.tier] ?? `Tier ${j.tier}`}</span>
            <span className="text-white/30">job #{j.jobId.toString()}</span>
            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${JOB_STATUS_CLASS[j.status] ?? JOB_STATUS_CLASS[0]}`}>
              {JOB_STATUS[j.status] ?? `status ${j.status}`}
            </span>
            <span className="text-white/40 ml-auto">{usdc(j.tierAmount)} USDC on accept</span>
          </div>
          {j.status === 2 && (
            <>
              <ContentView marketId={Number(marketId)} kind="deliver" contentKey={j.jobId.toString()} viewer={account} />
              {/* Reject is a FINAL-tier-only escape hatch from the ghost penalty (tier 3 = Final).
                  Lower tiers have no ghost timer, so Accept is the only action there. */}
              {j.tier === 3 ? (
                <>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Optional: reason for rejection — the worker sees this so they know what went wrong."
                    rows={2}
                    className="w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-white placeholder:text-white/30 focus:border-teal-500/50 focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    <Command label={`Accept & pay ${usdc(j.tierAmount)}`} disabled={!account}
                      onDone={() => { load(); onDone(); }}
                      run={() => sdk.completeTierJob(j.jobId, scope('accept'), account)} />
                    {!hideReject && (
                      <Command label="Reject" tone="neutral" disabled={!account}
                        onDone={() => { setRejectReason(''); load(); onDone(); }}
                        run={async () => {
                          // Store the (optional) reason in the content channel BEFORE rejecting, so the
                          // worker can read why. Authored by the requester = the job's evaluator.
                          if (rejectReason.trim()) {
                            await store(Number(marketId), 'reject', j.jobId.toString(), rejectReason.trim(), account);
                          }
                          return sdk.rejectTierJob(j.jobId, scope('reject'), account);
                        }} />
                    )}
                    <Command label="Request revision" tone="neutral" disabled={!account || j.revisionUsed}
                      onDone={() => { load(); onDone(); }}
                      run={() => sdk.requestRevision(j.jobId, account)} />
                  </div>
                  <p className="text-[11px] text-white/40 italic">
                    <b>Request revision</b> (once) sends it back for a fix — reopens the job, gives the
                    worker a fresh hour (they can self-extend). <b>Reject</b> kills it: no payout, no
                    slash, reserve refunds to you on Close. Either avoids the ghost penalty.
                    {j.revisionUsed && ' (Revision already used for this job.)'}
                  </p>
                </>
              ) : (
                <Command label={`Accept & pay ${usdc(j.tierAmount)}`} disabled={!account}
                  onDone={() => { load(); onDone(); }}
                  run={() => sdk.completeTierJob(j.jobId, scope('accept'), account)} />
              )}
            </>
          )}
          {j.status === 0 && (
            <p className="text-[11px] text-white/40 italic">Waiting on the worker to submit a deliverable.</p>
          )}
          {j.status === 3 && (
            <p className="text-[11px] text-success">Completed — {usdc(j.tierAmount)} USDC paid.</p>
          )}
          {j.status === 4 && (
            <>
              <p className="text-[11px] text-warning">Rejected — no payout; the amount refunds to you on Close market.</p>
              <ContentView marketId={Number(marketId)} kind="reject" contentKey={j.jobId.toString()} viewer={account} />
              {j.tier === 3 && (
                <p className="text-[11px] text-white/40">
                  The worker may contest a Final-tier rejection. If they do, Close is blocked until it
                  resolves — <Link href="/disputes" className="underline hover:text-white">counter the dispute</Link> (post a matching bond) to defend it before the jury.
                </p>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────────── Direct Job / Bounty actions ──────────────────────────── */

function DirectJobActions({ sdk, account, data, marketId, onChanged, closed }: { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; data: Loaded; marketId: bigint; onChanged: () => void; closed: boolean }) {
  const [idx, setIdx] = useState('0');
  return (
    <Card title="Direct Job actions" hint={closed ? 'Market closed — milestones are read-only.' : 'Accept pays the milestone; auto-release after the review window; cancel refunds pending.'}>
      {!closed && (
        <>
          <Field label="milestone index" value={idx} onChange={(e) => setIdx(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Command label="Accept milestone" disabled={!account} onDone={onChanged} run={() => sdk.acceptMilestone(marketId, BigInt(idx), account!)} />
            <Command label="Auto-release" tone="neutral" disabled={!account} onDone={onChanged} run={() => sdk.autoReleaseMilestone(marketId, BigInt(idx), account!)} />
            <Command label="Cancel job" tone="danger" disabled={!account} onDone={onChanged} run={() => sdk.cancelDirectJob(marketId, account!)} />
          </div>
        </>
      )}
      {data.milestones?.length > 0 && (
        <KV rows={data.milestones.map((m: any, i: number) => [`#${i} $${usdc(m.amount)}`, MILESTONE_STATUS[Number(m.status)] ?? String(m.status)])} />
      )}
      {closed && !(data.milestones?.length > 0) && (
        <p className="text-xs text-white/40">No milestones to show.</p>
      )}
    </Card>
  );
}

function BountyActions({ sdk, account, data, marketId, onChanged, closed }: { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; data: Loaded; marketId: bigint; onChanged: () => void; closed: boolean }) {
  const [idx, setIdx] = useState('0');
  const [award, setAward] = useState('50');
  return (
    <Card title="Bounty actions" hint={closed ? 'Market closed — findings are read-only.' : 'Accept pays at least the default award; reject is free; auto-escalate force-pays an ignored finding after the window.'}>
      {!closed && (
        <>
          <div className="grid grid-cols-2 gap-1">
            <Field label="finding index" value={idx} onChange={(e) => setIdx(e.target.value)} />
            <Field label="award USDC" value={award} onChange={(e) => setAward(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Command label="Accept finding" disabled={!account} onDone={onChanged} run={() => sdk.acceptFinding(marketId, BigInt(idx), toUnits(award), account!)} />
            <Command label="Reject" tone="neutral" disabled={!account} onDone={onChanged} run={() => sdk.rejectFinding(marketId, BigInt(idx), account!)} />
            <Command label="Auto-escalate" tone="neutral" disabled={!account} onDone={onChanged} run={() => sdk.autoEscalateFinding(marketId, BigInt(idx), account!)} />
            <Command label="Close bounty" tone="danger" disabled={!account} onDone={onChanged} run={() => sdk.closeBounty(marketId, account!)} />
          </div>
        </>
      )}
      {data.findings?.length > 0 && (
        <KV rows={data.findings.map((f: any, i: number) => [`#${i} ${short(f.submitter)}`, `${FINDING_STATUS[Number(f.status)] ?? f.status}${f.award ? ' · $' + usdc(f.award) : ''}`])} />
      )}
      {closed && !(data.findings?.length > 0) && (
        <p className="text-xs text-white/40">No findings to show.</p>
      )}
    </Card>
  );
}

/* ──────────────────────────── attribution opt-in (#9) ──────────────────────────── */

function AttributionOptIn({ sdk, account, marketId, closed }: { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; marketId: () => bigint; closed: boolean }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('100');
  const [shareBps, setShareBps] = useState('500');

  return (
    <Section title="Attribution pool" desc="Optional. Reward whoever introduced workers who advance in your market.">
      <div className="sm:col-span-2">
        <Card title="Reward introducers (optional)">
          {closed ? (
            <p className="text-sm text-white/50">This market is closed — an attribution pool can no longer be funded.</p>
          ) : !open ? (
            <>
              <p className="text-sm text-white/60">
                When a worker advances a tier, Echo can pay a share of their payout to whoever introduced
                them, funded from a separate pool you top up here. This is off by default; enable it only
                if you want to incentivise introductions.
              </p>
              <Button variant="secondary" onClick={() => setOpen(true)} className="mt-2">
                Set up an attribution pool
              </Button>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1">
                <Field label="pool amount USDC" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <Field label="introducer share (bps, 500 = 5%)" value={shareBps} onChange={(e) => setShareBps(e.target.value)} />
              </div>
              <p className="text-xs text-white/40">Approves ${amount} USDC to the market, then funds the pool.</p>
              <div className="flex items-center gap-2">
                <Command label={`Approve $${amount} + fund pool`} disabled={!account}
                  onDone={() => { setOpen(false); setAmount('100'); setShareBps('500'); }}
                  run={async () => {
                    await sdk.ensureUsdcAllowance(C.marketRegistry, toUnits(amount), account!);
                    return sdk.fundAttributionPool(marketId(), toUnits(amount), Number(shareBps), account!);
                  }} />
                <button onClick={() => setOpen(false)} className="text-xs text-white/40 hover:text-white transition">cancel</button>
              </div>
            </>
          )}
        </Card>
      </div>
    </Section>
  );
}

/* ──────────────────────────── feedback (preview only, no contract call exists yet) ──────────────────────────── */

function FeedbackPreview() {
  const [rating, setRating] = useState(5);
  return (
    <Section title="Feedback" desc="Leave a rating on a finalist's work. Note: feedback does not affect the ghost penalty — you avoid that by resolving the Final tier job (Accept, Reject, or Request revision) before its ghost deadline.">
      <div className="sm:col-span-2">
        <div className={CARD_CLASS}>
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-white/40" />
            <h3 className="text-sm font-semibold text-white">Leave feedback</h3>
            <Badge tone="warning">Preview — not yet wired to a contract</Badge>
          </div>
          <div className="flex items-center gap-1 mb-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating(n)} aria-label={`${n} star`}>
                <Star className={`w-5 h-5 ${n <= rating ? 'fill-warning text-warning' : 'text-white/20'}`} />
              </button>
            ))}
          </div>
          <TextArea label="feedback" rows={3} placeholder="How did this finalist perform?" disabled />
          <p className="mt-2 text-xs text-warning flex items-center gap-1.5">
            <Ghost className="w-3.5 h-3.5" /> This protocol does not yet have an on-chain feedback mechanism, so this form cannot submit.
          </p>
        </div>
      </div>
    </Section>
  );
}
