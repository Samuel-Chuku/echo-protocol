'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { useQuery, gql } from 'urql';
import { EchoMode, CONTRACTS } from '@echo/sdk';
import { useEcho } from '@/lib/sdk';
import { useContent } from '@/lib/content';
import { Section, Card, Field, KV } from '@/components/ui';
import { Command } from '@/components/Command';
import { Receipt } from '@/components/Receipt';
import { usdc, scope, toUnits, short, modeName, txLink, FINDING_STATUS, MILESTONE_STATUS } from '@/lib/format';
import { eventLabel, summarizeArgs, timeAgo, type ActivityRow } from '@/lib/activity';

// Arc JobStatus pills mirror /apply/[id] so the worker and requester see the same vocabulary.
const JOB_STATUS = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired'];
const JOB_STATUS_CLASS = [
  'bg-sky-50 text-sky-700 border-sky-200',
  'bg-sky-50 text-sky-700 border-sky-200',
  'bg-amber-50 text-amber-700 border-amber-200',
  'bg-emerald-50 text-emerald-700 border-emerald-200',
  'bg-red-50 text-red-700 border-red-200',
  'bg-gray-100 text-gray-600 border-gray-200',
];

/** Per-participant settlement rollup parsed from TierPayout + GhostPenalty events. */
type PayoutSummary = {
  total: bigint;            // sum of TierPayout.net
  perTier: Map<number, bigint>; // tier (EchoHook.Tier enum) → cumulative net
  ghostSlashed: bigint;     // sum of GhostPenalty.ghostAmount (subtracted from earnings IRL)
};

/** EchoHook.Tier enum → label for the per-row payouts line. Indices 0–4 cover the Open-mode tiers. */
const HOOK_TIER_LABELS: Record<number, string> = {
  0: 'Submitted', 1: 'Substantive', 2: 'Shortlist', 3: 'Final', 4: 'Ghost', 5: 'Milestone', 6: 'Finding',
};

const C = CONTRACTS.arcTestnet;

/**
 * Per-market management (#12). Loads one market by route id and drives its lifecycle, gated by mode:
 * Open/Reveal grading + held-stake resolution, Direct-Job milestones, Bounty findings. Attribution
 * funding is an explicit opt-in step with an explainer (#9), not always-on.
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
};

const MARKET_ACTIVITY = gql`
  query MarketActivity($marketId: Int!) {
    marketActivity(marketId: $marketId, limit: 200) {
      id blockNumber txHash eventName marketId actor args state createdAt
    }
  }
`;

export default function ManageMarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { sdk, account } = useEcho();
  const [idx, setIdx] = useState('0');
  const [award, setAward] = useState('50');
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState('');

  const marketId = () => BigInt(id || '0');

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
        const net = BigInt(String(args.net ?? '0'));
        e.total += net;
        e.perTier.set(tier, (e.perTier.get(tier) ?? 0n) + net);
      } else {
        e.ghostSlashed += BigInt(String(args.ghostAmount ?? '0'));
      }
      m.set(who, e);
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
        mode, market: { ...(market as object), stakeRequired }, remaining: remaining as bigint,
        apps, findings, milestones, revealFee: revealFee as bigint, flagWindow: flagWindow as bigint,
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
        <Link href="/hire" className="text-xs text-gray-500 hover:text-gray-900">← My markets</Link>
        <Link href="/disputes" className="text-xs text-gray-500 hover:text-gray-900">Disputes →</Link>
      </div>
      <h1 className="text-2xl font-bold mt-1 mb-1">Market #{id}</h1>
      <p className="text-sm text-gray-500 mb-6">{data ? modeName(data.mode) : 'Loading…'}{data?.market?.subject ? ` · ${data.market.subject}` : ''}</p>

      <Section title="Status" desc="Live on-chain state for this market.">
        <Card title="Overview">
          <Command label="Refresh" tone="neutral" run={async () => { await load(); return 'refreshed'; }} />
          {err && <p className="text-xs text-red-600 break-all">{err}</p>}
          {data && (
            <KV rows={[
              ['mode', modeName(data.mode)],
              ['requester', short(data.market?.requester)],
              ['escrow remaining', usdc(data.remaining)],
              ['reveal fee R', data.revealFee ? usdc(data.revealFee) : '—'],
              ['flag window', data.flagWindow ? `${Number(data.flagWindow) / 86400}d` : '—'],
              ['applicants', String(data.market?.applicantCount ?? '—')],
              ['closed', String(data.market?.closed ?? '—')],
            ]} />
          )}
        </Card>

        {data && (
          <div className="sm:col-span-2">
            <Receipt
              marketId={id}
              mode={data.mode}
              status={data.market?.closed ? 'closed' : 'active'}
              requester={data.market?.requester}
              worker={data.mode === EchoMode.DirectJob ? data.market?.worker : undefined}
              amount={data.market?.escrowTotal != null ? String(data.market.escrowTotal) : undefined}
              amountLabel="Escrow"
            />
          </div>
        )}

        {/* Open/Reveal actions */}
        {data?.mode === EchoMode.OpenMarket && (
          <>
            <Card title="Applicants" hint="One row per applicant. Actions appear based on their current tier.">
              {data.apps?.length === 0 ? (
                <p className="text-xs text-gray-400">No one has applied yet.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {data.apps.map((a: any) => (
                    <ApplicantRow
                      key={a.participant}
                      sdk={sdk}
                      account={account}
                      marketId={marketId()}
                      app={a}
                      requester={data.market?.requester}
                      revealFee={data.revealFee}
                      hasStake={!!data.market?.stakeRequired && BigInt(data.market.stakeRequired) > 0n}
                      payout={payouts.get(String(a.participant).toLowerCase())}
                      onDone={load}
                    />
                  ))}
                </ul>
              )}
              <div className="pt-2 border-t border-gray-100 mt-2">
                <Command label="Close market" tone="neutral" disabled={!account} onDone={load} run={() => sdk.closeMarket(marketId(), account!)} />
              </div>
            </Card>

            <Card title="What do these actions mean?">
              <dl className="text-xs text-gray-600 space-y-1.5">
                <div><dt className="inline font-semibold text-gray-800">Reveal</dt><dd className="inline"> — you pay the reveal fee R to unlock this applicant&apos;s submission. Available only on reveal markets (R &gt; 0). Advances them to tier 1.</dd></div>
                <div><dt className="inline font-semibold text-gray-800">Substantive / Shortlist / Final</dt><dd className="inline"> — grade up to the next tier. Each tier payout funds an on-chain job.</dd></div>
                <div><dt className="inline font-semibold text-gray-800">Settle stake</dt><dd className="inline"> — release the held reveal stake back to the applicant. Permissionless; only after the flag window elapses without dispute. Shows only when the market required a stake.</dd></div>
                <div><dt className="inline font-semibold text-gray-800">Trigger ghost</dt><dd className="inline"> — penalize a Final-tier applicant who failed to deliver before the ghost deadline. Slashes part of their reward as `ghostAmount` and credits the requester.</dd></div>
                <div className="pt-1.5 mt-1.5 border-t border-gray-100"><dd className="text-gray-500">Suspect a bait-and-switch reveal? <Link href="/disputes" className="underline hover:text-gray-700">Open a bonded stake dispute</Link> while the flag window is open.</dd></div>
              </dl>
            </Card>
          </>
        )}

        {/* Direct Job actions */}
        {data?.mode === EchoMode.DirectJob && (
          <Card title="Direct Job actions" hint="accept pays the milestone; auto-release after the review window; cancel refunds pending.">
            <Field label="milestone index" value={idx} onChange={(e) => setIdx(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Command label="Accept milestone" disabled={!account} onDone={load} run={() => sdk.acceptMilestone(marketId(), BigInt(idx), account!)} />
              <Command label="Auto-release" tone="neutral" disabled={!account} onDone={load} run={() => sdk.autoReleaseMilestone(marketId(), BigInt(idx), account!)} />
              <Command label="Cancel job" tone="danger" disabled={!account} onDone={load} run={() => sdk.cancelDirectJob(marketId(), account!)} />
            </div>
            {data.milestones?.length > 0 && (
              <KV rows={data.milestones.map((m: any, i: number) => [`#${i} ${usdc(m.amount)}`, MILESTONE_STATUS[Number(m.status)] ?? String(m.status)])} />
            )}
          </Card>
        )}

        {/* Bounty actions */}
        {data?.mode === EchoMode.Bounty && (
          <Card title="Bounty actions" hint="accept pays ≥ defaultAward; reject is free; auto-escalate force-pays an ignored finding after the window.">
            <div className="grid grid-cols-2 gap-1">
              <Field label="finding index" value={idx} onChange={(e) => setIdx(e.target.value)} />
              <Field label="award USDC" value={award} onChange={(e) => setAward(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Command label="Accept finding" disabled={!account} onDone={load} run={() => sdk.acceptFinding(marketId(), BigInt(idx), toUnits(award), account!)} />
              <Command label="Reject" tone="neutral" disabled={!account} onDone={load} run={() => sdk.rejectFinding(marketId(), BigInt(idx), account!)} />
              <Command label="Auto-escalate" tone="neutral" disabled={!account} onDone={load} run={() => sdk.autoEscalateFinding(marketId(), BigInt(idx), account!)} />
              <Command label="Close bounty" tone="danger" disabled={!account} onDone={load} run={() => sdk.closeBounty(marketId(), account!)} />
            </div>
            {data.findings?.length > 0 && (
              <KV rows={data.findings.map((f: any, i: number) => [`#${i} ${short(f.submitter)}`, `${FINDING_STATUS[Number(f.status)] ?? f.status}${f.award ? ' · ' + usdc(f.award) : ''}`])} />
            )}
          </Card>
        )}
      </Section>

      <MarketTimeline rows={activityRows} fetching={actFetching} onRefresh={() => refetchActivity({ requestPolicy: 'network-only' })} />

      <AttributionOptIn sdk={sdk} account={account} marketId={marketId} />
    </div>
  );
}

/* ──────────────────────────── per-market timeline ──────────────────────────── */

/** Chronological event log for a market. Data + refetch handler come from the parent so we share
 *  one fetch with the per-applicant payout rollup. */
function MarketTimeline({ rows, fetching, onRefresh }: { rows: ActivityRow[]; fetching: boolean; onRefresh: () => void }) {
  const now = Math.floor(Date.now() / 1000);
  return (
    <Section title="Timeline" desc="Every on-chain event for this market, oldest first.">
      <div className="sm:col-span-2">
        <Card title="What's happened">
          <div className="flex items-center justify-end -mt-1 mb-1">
            <button onClick={onRefresh} className="text-xs text-gray-400 hover:text-gray-700 underline">Refresh</button>
          </div>
          {fetching && rows.length === 0 && <p className="text-xs text-gray-400">Loading…</p>}
          {!fetching && rows.length === 0 && <p className="text-xs text-gray-400">No events yet.</p>}
          {rows.length > 0 && (
            <ol className="relative border-l border-gray-200 ml-2 space-y-3">
              {rows.map((r) => (
                <li key={r.id} className="ml-4">
                  <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-gray-900 border border-white" />
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{eventLabel(r.eventName)}</span>
                        <span className="text-[10px] text-gray-400 tabular-nums">{timeAgo(r.createdAt, now)} · block {r.blockNumber}</span>
                      </div>
                      <div className="text-xs text-gray-500 font-mono mt-0.5 truncate">{summarizeArgs(r.args)}</div>
                    </div>
                    <a href={txLink(r.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 shrink-0">
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

/* ──────────────────────────── applicant row (Open / Reveal) ──────────────────────────── */

const TIER_LABELS = ['Applied', 'Revealed', 'Shortlist', 'Final'];
const TIER_PILL = [
  'bg-gray-100 text-gray-700',
  'bg-sky-100 text-sky-800',
  'bg-amber-100 text-amber-800',
  'bg-emerald-100 text-emerald-800',
];

function ApplicantRow({
  sdk, account, marketId, app, requester, revealFee, hasStake, payout, onDone,
}: {
  sdk: ReturnType<typeof useEcho>['sdk'];
  account?: `0x${string}`;
  marketId: bigint;
  app: { participant: `0x${string}`; tierReached: number; agentId?: bigint | string; receiptTokenId?: bigint | string; submissionHash?: string; tierJobIds?: bigint[] };
  requester?: string;
  revealFee: bigint;
  hasStake: boolean;
  payout?: PayoutSummary;
  onDone: () => void;
}) {
  const tier = Number(app.tierReached);
  const isRevealMarket = revealFee > 0n;
  const p = app.participant;
  const ready = !!account;
  const agentId = app.agentId ? String(app.agentId) : null;
  const receiptId = app.receiptTokenId ? String(app.receiptTokenId) : null;
  const subHash = app.submissionHash && app.submissionHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' ? app.submissionHash : null;
  const isRequester = !!account && !!requester && account.toLowerCase() === requester.toLowerCase();
  const tierJobIds = (app.tierJobIds ?? []) as bigint[];
  const [showApp, setShowApp] = useState(false);
  const [showJobs, setShowJobs] = useState(false);
  // Per-tier breakdown for the payouts line, sorted by tier index. EchoHook.Tier indices:
  // 0 Submitted (reveal) · 1 Substantive · 2 Shortlist · 3 Final · 4 Ghost · 5 Milestone · 6 Finding.
  const tierBreakdown = payout
    ? Array.from(payout.perTier.entries()).sort((a, b) => a[0] - b[0])
    : [];
  // "What's next" line so the requester knows what to do or what to expect from the contract.
  const nextStep = (() => {
    if (tier === 0) return isRevealMarket
      ? 'Pay R to unlock their submission. They advance to Revealed.'
      : 'Grade them up to Substantive — pays out tier[0].';
    if (tier === 1) return 'Grade up to Shortlist (pays tier[1]), or settle the held stake once the flag window elapses.';
    if (tier === 2) return 'Grade up to Final (creates the delivery job at AgenticCommerce with the ghost deadline).';
    if (tier === 3) return 'Awaiting delivery — they auto-receive tier[2] on completion. If they miss the deadline, Trigger ghost slashes ghostAmount back to you.';
    return null;
  })();

  // Tier transitions:
  //   0 → 1  : reveal() (reveal market)        OR  gradeSubstantive() (non-reveal)
  //   1 → 2  : gradeShortlist()
  //   2 → 3  : gradeFinal()
  //   3      : terminal — `triggerGhost` is the only meaningful action if they failed to deliver.
  const advance = (() => {
    if (tier === 0) {
      return isRevealMarket
        ? { label: 'Reveal', run: () => sdk.reveal(marketId, p, account!) }
        : { label: 'Grade Substantive', run: () => sdk.gradeSubstantive(marketId, p, account!) };
    }
    if (tier === 1) return { label: 'Grade Shortlist', run: () => sdk.gradeShortlist(marketId, p, account!) };
    if (tier === 2) return { label: 'Grade Final', run: () => sdk.gradeFinal(marketId, p, account!) };
    return null;
  })();

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/u/${p}`} className="font-mono text-sm text-gray-700 hover:underline shrink-0">{short(p)}</Link>
        <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TIER_PILL[tier] ?? 'bg-gray-100 text-gray-500'}`}>
          {TIER_LABELS[tier] ?? `tier ${tier}`}
        </span>
        <div className="flex flex-wrap gap-1.5 ml-auto">
          {advance && (
            <Command label={advance.label} disabled={!ready} onDone={onDone} run={advance.run} />
          )}
          {tier >= 1 && hasStake && (
            <Command
              label="Settle stake"
              tone="neutral"
              disabled={!ready}
              onDone={onDone}
              run={() => sdk.settleRevealStake(marketId, p, account!)}
            />
          )}
          {tier === 3 && (
            <Command
              label="Trigger ghost"
              tone="neutral"
              disabled={!ready}
              onDone={onDone}
              run={() => sdk.triggerGhost(marketId, p, account!)}
            />
          )}
        </div>
      </div>
      {/* Details line — appears once we know who they are (always for revealed+; useful at tier 0 too). */}
      {(agentId || receiptId || subHash) && (
        <div className="mt-1 text-[11px] text-gray-500 font-mono flex flex-wrap gap-x-3 gap-y-0.5">
          {agentId && <span>agentId <span className="text-gray-700">{agentId}</span></span>}
          {receiptId && <span>receipt <span className="text-gray-700">#{receiptId}</span></span>}
          {subHash && <span className="truncate max-w-[18rem]" title={subHash}>submission <span className="text-gray-700">{short(subHash)}</span></span>}
        </div>
      )}
      {/* Payouts so far — derived from indexer TierPayout + GhostPenalty events. */}
      {payout && payout.total > 0n && (
        <div className="mt-1 text-[11px] text-emerald-700 flex flex-wrap gap-x-3 gap-y-0.5">
          <span className="font-medium">Paid {usdc(payout.total)} USDC</span>
          <span className="text-gray-500">
            {tierBreakdown.map(([t, amt], i) => (
              <span key={t}>
                {i > 0 ? ' · ' : ''}{HOOK_TIER_LABELS[t] ?? `t${t}`} {usdc(amt)}
              </span>
            ))}
          </span>
          {payout.ghostSlashed > 0n && (
            <span className="text-red-600">− slashed {usdc(payout.ghostSlashed)} USDC (ghost)</span>
          )}
        </div>
      )}
      {nextStep && (
        <p className="mt-1 text-[11px] text-gray-500 italic">{nextStep}</p>
      )}
      {/* Toggles for content + tier jobs — only visible to the requester, and only when there's something to look at. */}
      {isRequester && (tier >= 1 || tierJobIds.length > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-3">
          {tier >= 1 && (
            <button onClick={() => setShowApp((v) => !v)} className="text-[11px] text-gray-500 hover:text-gray-900 underline">
              {showApp ? 'Hide application' : 'View application'}
            </button>
          )}
          {tierJobIds.length > 0 && (
            <button onClick={() => setShowJobs((v) => !v)} className="text-[11px] text-gray-500 hover:text-gray-900 underline">
              {showJobs ? 'Hide tier jobs' : `Tier jobs (${tierJobIds.length})`}
            </button>
          )}
        </div>
      )}
      {showApp && isRequester && (
        <ContentView marketId={Number(marketId)} kind="apply" contentKey={p} viewer={account!} />
      )}
      {showJobs && isRequester && (
        <ApplicantTierJobs sdk={sdk} account={account!} marketId={marketId} tierJobIds={tierJobIds} onDone={onDone} />
      )}
    </li>
  );
}

/* ──────────────────────────── content viewer + tier-job accept ──────────────────────────── */

/** Lazy-fetch + render a content blob from the indexer. Signs once on click — the indexer
 *  enforces gating (apply: requester after reveal; deliver: provider or evaluator of the Arc job). */
function ContentView({ marketId, kind, contentKey, viewer }: {
  marketId: number; kind: 'apply' | 'deliver'; contentKey: string; viewer: `0x${string}`;
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
    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
        {kind === 'apply' ? 'Application body' : 'Deliverable body'}
      </div>
      {loading && <p className="text-xs text-gray-400">Loading… (sign to authorize read)</p>}
      {err && <p className="text-xs text-red-600 break-all">{err}</p>}
      {!loading && !err && body === null && <p className="text-xs text-gray-400 italic">No body stored.</p>}
      {!loading && body !== null && <p className="text-sm text-gray-700 whitespace-pre-wrap">{body}</p>}
    </div>
  );
}

function ApplicantTierJobs({ sdk, account, marketId, tierJobIds, onDone }: {
  sdk: ReturnType<typeof useEcho>['sdk']; account: `0x${string}`; marketId: bigint;
  tierJobIds: bigint[]; onDone: () => void;
}) {
  type Job = { jobId: bigint; status: number; tier: number; tierAmount: bigint };
  const [jobs, setJobs] = useState<Job[]>([]);
  const idsKey = tierJobIds.map((j) => j.toString()).join(',');

  const load = useCallback(async () => {
    if (tierJobIds.length === 0) { setJobs([]); return; }
    const rows = await Promise.all(tierJobIds.map(async (jobId) => {
      const [arcJob, ctx] = await Promise.all([
        sdk.getArcJob(jobId).catch(() => null) as Promise<{ status: number } | null>,
        sdk.getJobContext(jobId).catch(() => null) as Promise<{ tier: number; tierAmount: bigint } | null>,
      ]);
      return { jobId, status: arcJob?.status ?? 0, tier: ctx?.tier ?? 0, tierAmount: ctx?.tierAmount ?? 0n };
    }));
    setJobs(rows);
  }, [sdk, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-white px-3 py-2 space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">Tier jobs</div>
      {jobs.length === 0 && <p className="text-xs text-gray-400">Loading…</p>}
      {jobs.map((j) => (
        <div key={j.jobId.toString()} className="border-t border-gray-100 first:border-0 pt-2 first:pt-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="font-medium text-gray-700">{HOOK_TIER_LABELS[j.tier] ?? `Tier ${j.tier}`}</span>
            <span className="text-gray-400">job #{j.jobId.toString()}</span>
            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${JOB_STATUS_CLASS[j.status] ?? JOB_STATUS_CLASS[0]}`}>
              {JOB_STATUS[j.status] ?? `status ${j.status}`}
            </span>
            <span className="text-gray-400 ml-auto">{usdc(j.tierAmount)} USDC on accept</span>
          </div>
          {j.status === 2 && (
            <>
              <ContentView marketId={Number(marketId)} kind="deliver" contentKey={j.jobId.toString()} viewer={account} />
              <Command label={`Accept & pay ${usdc(j.tierAmount)}`} disabled={!account}
                onDone={() => { load(); onDone(); }}
                run={() => sdk.completeTierJob(j.jobId, scope('accept'), account)} />
            </>
          )}
          {j.status === 0 && (
            <p className="text-[11px] text-gray-500 italic">Waiting on the worker to submit a deliverable.</p>
          )}
          {j.status === 3 && (
            <p className="text-[11px] text-emerald-700">Completed — {usdc(j.tierAmount)} USDC paid.</p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────────── attribution opt-in (#9) ──────────────────────────── */

function AttributionOptIn({ sdk, account, marketId }: { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; marketId: () => bigint }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('100');
  const [shareBps, setShareBps] = useState('500');

  return (
    <Section title="Attribution pool" desc="Optional. Reward whoever introduced workers who advance in your market.">
      <div className="sm:col-span-2">
        <Card title="Reward introducers (optional)">
          {!open ? (
            <>
              <p className="text-sm text-gray-600">
                When a worker advances a tier, Echo can pay a share of their payout to whoever introduced
                them — funded from a separate pool you top up here. This is off by default; enable it only
                if you want to incentivise introductions.
              </p>
              <button onClick={() => setOpen(true)} className="mt-2 inline-flex px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-800 hover:bg-gray-200">
                Set up an attribution pool
              </button>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1">
                <Field label="pool amount USDC" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <Field label="introducer share (bps, 500 = 5%)" value={shareBps} onChange={(e) => setShareBps(e.target.value)} />
              </div>
              <p className="text-xs text-gray-400">Approves {amount} USDC to the market, then funds the pool.</p>
              <div className="flex items-center gap-2">
                <Command label={`Approve ${amount} + fund pool`} disabled={!account}
                  run={async () => {
                    await sdk.ensureUsdcAllowance(C.marketRegistry, toUnits(amount), account!);
                    return sdk.fundAttributionPool(marketId(), toUnits(amount), Number(shareBps), account!);
                  }} />
                <button onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:text-gray-900">cancel</button>
              </div>
            </>
          )}
        </Card>
      </div>
    </Section>
  );
}
