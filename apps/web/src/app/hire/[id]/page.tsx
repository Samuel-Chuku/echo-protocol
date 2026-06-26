'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Clock, Ghost, MessageSquare, Star } from 'lucide-react';
import { EchoMode, CONTRACTS } from '@echo/sdk';
import { useEcho } from '@/lib/sdk';
import { Section, Card, Field, TextArea, KV, Badge, Button, EmptyState, CARD_CLASS } from '@/components/ui';
import { Command } from '@/components/Command';
import { TxModal } from '@/components/TxModal';
import { TierAdvanceModal } from '@/components/TierAdvanceModal';
import { GhostPenaltyModal } from '@/components/GhostPenaltyModal';
import { usdc, toUnits, short, modeName, modeBadgeTone, FINDING_STATUS, MILESTONE_STATUS } from '@/lib/format';

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

const TIER_LABELS = ['Applied', 'Revealed', 'Shortlist', 'Final'];

export default function ManageMarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { sdk, account } = useEcho();
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [ghostResult, setGhostResult] = useState<{ amount: string; finalists: string[] } | null>(null);

  const marketId = () => BigInt(id || '0');

  async function load() {
    setErr('');
    try {
      const mid = marketId();
      const mode = Number(await sdk.marketMode(mid));
      const [market, remaining, revealFee, flagWindow] = await Promise.all([
        sdk.getMarket(mid),
        sdk.remainingEscrow(mid).catch(() => 0n),
        sdk.revealFee(mid).catch(() => 0n),
        sdk.revealFlagWindow(mid).catch(() => 0n),
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
              ['flag window', data.flagWindow ? `${Number(data.flagWindow) / 86400}d` : '—'],
              ['ghost deadline', data.ghostDeadline ? `${Number(data.ghostDeadline) / 86400}d after final round` : '—'],
              ['applicants', String(data.market?.applicantCount ?? '—')],
            ]} />
          )}
        </Card>

        {data?.mode === EchoMode.OpenMarket && (
          <div className="sm:col-span-2 space-y-3">
            <ApplicantList sdk={sdk} account={account} data={data} marketId={marketId()} onChanged={load} onGhost={setGhostResult} />
            <div className={CARD_CLASS}>
              <h3 className="text-sm font-semibold text-white">Close market</h3>
              <p className="text-xs text-white/40 mt-0.5">Returns unspent USDC to you. A reveal market needs its minimum-reveal floor met first.</p>
              <Button variant="danger" className="mt-3" onClick={() => setCloseOpen(true)}>Close market</Button>
            </div>
          </div>
        )}

        {/* Direct Job actions */}
        {data?.mode === EchoMode.DirectJob && (
          <DirectJobActions sdk={sdk} account={account} data={data} marketId={marketId()} onChanged={load} />
        )}

        {/* Bounty actions */}
        {data?.mode === EchoMode.Bounty && (
          <BountyActions sdk={sdk} account={account} data={data} marketId={marketId()} onChanged={load} />
        )}
      </Section>

      <AttributionOptIn sdk={sdk} account={account} marketId={marketId} />
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
      {ghostResult && <GhostPenaltyModal amount={ghostResult.amount} finalists={ghostResult.finalists} onClose={() => setGhostResult(null)} />}
    </div>
  );
}

/* ──────────────────────────── Open/Reveal applicant list ──────────────────────────── */

function ApplicantList({
  sdk, account, data, marketId, onChanged, onGhost,
}: {
  sdk: ReturnType<typeof useEcho>['sdk'];
  account?: `0x${string}`;
  data: Loaded;
  marketId: bigint;
  onChanged: () => void;
  onGhost: (r: { amount: string; finalists: string[] }) => void;
}) {
  const [advance, setAdvance] = useState<{ participant: string; fromLabel: string; toLabel: string; amount: string; run: () => Promise<unknown> } | null>(null);
  const apps = data.apps ?? [];
  const tierAmounts: bigint[] = data.market?.tierAmounts ?? [];
  const ghostAmount = tierAmounts[3] !== undefined ? usdc(tierAmounts[3]) : '0';
  const now = Math.floor(Date.now() / 1000);

  function nextAction(a: any) {
    const t = Number(a.tierReached);
    if (t === 0) {
      return data.revealFee > 0n
        ? { label: 'Reveal', toLabel: 'Revealed', amount: usdc(data.revealFee), run: () => sdk.reveal(marketId, a.participant, account!) }
        : { label: 'Grade Substantive', toLabel: 'Revealed', amount: usdc(tierAmounts[0] ?? 0n), run: () => sdk.gradeSubstantive(marketId, a.participant, account!) };
    }
    if (t === 1) return { label: 'Advance', toLabel: 'Shortlist', amount: usdc(tierAmounts[1] ?? 0n), run: () => sdk.gradeShortlist(marketId, a.participant, account!) };
    if (t === 2) return { label: 'Advance', toLabel: 'Final', amount: usdc(tierAmounts[2] ?? 0n), run: () => sdk.gradeFinal(marketId, a.participant, account!) };
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
          // Best-effort estimate only — appliedAt is when they applied, not when they reached Final.
          const ghostDeadlineEstimate = t === 3 && data.ghostDeadline ? Number(a.appliedAt) + Number(data.ghostDeadline) : null;
          const ghostPassed = ghostDeadlineEstimate !== null && now > ghostDeadlineEstimate;

          return (
            <li key={a.participant} className="py-3 flex flex-wrap items-center gap-3">
              <span className="font-mono text-sm text-white">{short(a.participant)}</span>
              <Badge tone={t === 3 ? 'success' : 'neutral'}>{TIER_LABELS[t] ?? `tier ${t}`}</Badge>
              <span className="text-xs text-white/30 font-mono truncate max-w-[10rem]" title={a.submissionHash}>
                {a.submissionHash}
              </span>

              {t === 3 && ghostDeadlineEstimate !== null && (
                <span className={`text-xs flex items-center gap-1 ${ghostPassed ? 'text-danger' : 'text-warning'}`}>
                  <Clock className="w-3 h-3" />
                  {ghostPassed ? 'Ghost deadline passed (est.)' : `~${Math.max(0, Math.ceil((ghostDeadlineEstimate - now) / 86400))}d to ghost deadline (est.)`}
                </span>
              )}

              <span className="ml-auto flex items-center gap-2">
                {next && (
                  <Button
                    variant="secondary"
                    onClick={() => setAdvance({ participant: a.participant, fromLabel: TIER_LABELS[t], toLabel: next.toLabel, amount: next.amount, run: next.run })}
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
                    run={() => sdk.triggerGhost(marketId, a.participant, account!)}
                    onDone={() => {
                      onChanged();
                      onGhost({ amount: ghostAmount, finalists: apps.filter((x: any) => Number(x.tierReached) === 3).map((x: any) => x.participant) });
                    }}
                  />
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-xs text-white/30">
        Flag a revealed applicant as bait-and-switch instead of advancing them by opening a{' '}
        <Link href="/disputes" className="underline hover:text-white">bonded stake dispute</Link>.
      </p>

      {advance && (
        <TierAdvanceModal
          participant={advance.participant}
          fromLabel={advance.fromLabel}
          toLabel={advance.toLabel}
          amount={advance.amount}
          run={advance.run}
          onClose={() => setAdvance(null)}
          onDone={onChanged}
        />
      )}
    </div>
  );
}

/* ──────────────────────────── Direct Job / Bounty (unchanged actions, restyled) ──────────────────────────── */

function DirectJobActions({ sdk, account, data, marketId, onChanged }: { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; data: Loaded; marketId: bigint; onChanged: () => void }) {
  const [idx, setIdx] = useState('0');
  return (
    <Card title="Direct Job actions" hint="Accept pays the milestone; auto-release after the review window; cancel refunds pending.">
      <Field label="milestone index" value={idx} onChange={(e) => setIdx(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Command label="Accept milestone" disabled={!account} onDone={onChanged} run={() => sdk.acceptMilestone(marketId, BigInt(idx), account!)} />
        <Command label="Auto-release" tone="neutral" disabled={!account} onDone={onChanged} run={() => sdk.autoReleaseMilestone(marketId, BigInt(idx), account!)} />
        <Command label="Cancel job" tone="danger" disabled={!account} onDone={onChanged} run={() => sdk.cancelDirectJob(marketId, account!)} />
      </div>
      {data.milestones?.length > 0 && (
        <KV rows={data.milestones.map((m: any, i: number) => [`#${i} $${usdc(m.amount)}`, MILESTONE_STATUS[Number(m.status)] ?? String(m.status)])} />
      )}
    </Card>
  );
}

function BountyActions({ sdk, account, data, marketId, onChanged }: { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; data: Loaded; marketId: bigint; onChanged: () => void }) {
  const [idx, setIdx] = useState('0');
  const [award, setAward] = useState('50');
  return (
    <Card title="Bounty actions" hint="Accept pays at least the default award; reject is free; auto-escalate force-pays an ignored finding after the window.">
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
      {data.findings?.length > 0 && (
        <KV rows={data.findings.map((f: any, i: number) => [`#${i} ${short(f.submitter)}`, `${FINDING_STATUS[Number(f.status)] ?? f.status}${f.award ? ' · $' + usdc(f.award) : ''}`])} />
      )}
    </Card>
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
    <Section title="Feedback" desc="Send feedback on a finalist within 7 days of their final round to avoid a ghost penalty.">
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
