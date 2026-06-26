'use client';

import { use, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft, ShieldCheck } from 'lucide-react';
import { useQuery, gql } from 'urql';
import { EchoMode, CONTRACTS } from '@echo/sdk';
import { useEcho } from '@/lib/sdk';
import { useAgent } from '@/lib/agent';
import { Section, Card, Field, KV, Badge, Button, CARD_CLASS, TierTrack, type TierStep } from '@/components/ui';
import { Command } from '@/components/Command';
import { TxModal } from '@/components/TxModal';
import { RegisterIdentityModal } from '@/components/RegisterIdentityModal';
import { IdentityBanner } from '@/components/IdentityBanner';
import { usdc, scope, short, modeName, modeBadgeTone, isZeroAddr, MILESTONE_STATUS } from '@/lib/format';

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

  const [{ data, fetching, error }] = useQuery<{ market: MarketDetail | null }>({ query: MARKET, variables: { id: Number(id) } });
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

      {fetching && !m && <p className="text-sm text-white/40">Loading…</p>}
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
          </Section>

          {m.mode === EchoMode.OpenMarket && tierSteps.length > 0 && (
            <Section title="Payout ladder" desc="What you earn as you advance through each round.">
              <div className={`${CARD_CLASS} sm:col-span-2 py-6`}>
                <TierTrack steps={tierSteps} />
              </div>
            </Section>
          )}

          {m.mode === EchoMode.OpenMarket && <OpenApply sdk={sdk} account={account} agentId={agentId} marketId={BigInt(id)} closed={m.status !== 'active'} />}
          {m.mode === EchoMode.DirectJob && <DirectDeliver sdk={sdk} account={account} marketId={BigInt(id)} worker={m.worker} />}
          {m.mode === EchoMode.Bounty && <BountyDeliver sdk={sdk} account={account} agentId={agentId} marketId={BigInt(id)} closed={m.status !== 'active'} />}
        </>
      )}
    </div>
  );
}

/* ──────────────── Open/Reveal: apply ──────────────── */
function OpenApply({ sdk, account, agentId, marketId, closed }: { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; agentId: string; marketId: bigint; closed: boolean }) {
  const [submission, setSubmission] = useState('my-application-v1');
  const [app, setApp] = useState<any>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const need = !account;

  return (
    <Section title="Apply" desc="Submit your application. The requester reveals, grades, and advances applicants through tiers.">
      <div className="sm:col-span-2 space-y-3">
        <div className="rounded-xl border border-warning/20 bg-warning/[0.06] px-4 py-3 text-sm text-white/70">
          <b className="font-semibold text-white">$5 stake required to apply.</b> It is held until you are revealed.
          Withdraw before being revealed and the full stake is refunded. Get revealed and fail to deliver, and the
          stake is forfeited to cover the requester&apos;s review cost.
        </div>

        <Card title="Apply to this market" hint="Mints a participation receipt; pulls the stake if the market requires one.">
          <Field label="submission text → hash" value={submission} onChange={(e) => setSubmission(e.target.value)} />
          {closed && <p className="text-xs text-warning">This market is no longer active.</p>}
          {!account && <p className="text-xs text-warning">Connect a wallet to apply.</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => (agentId ? setApplyOpen(true) : setIdentityOpen(true))}
              disabled={need || closed}
            >
              Apply — pay $5 stake
            </Button>
            <Command label="Load my application" tone="neutral" disabled={!account}
              run={async () => { setApp(await sdk.getApplication(marketId, account!)); return 'loaded'; }} />
          </div>
          {app && (
            <KV rows={[
              ['tier reached', String(app.tierReached)],
              ['agentId', String(app.agentId)],
              ['receipt #', String(app.receiptTokenId)],
              ['withdrawn', String(app.withdrawn)],
            ]} />
          )}
        </Card>

        {applyOpen && (
          <TxModal
            title="Apply to this market"
            description="This pulls your $5 USDC stake into the market escrow. It is refunded if you withdraw before being revealed."
            confirmLabel="Apply — pay $5 stake"
            run={async () => {
              const stake = await sdk.marketStakeRequired(marketId).catch(() => 0n);
              if (stake > 0n) await sdk.ensureUsdcAllowance(C.marketRegistry, stake, account!);
              return sdk.applyToMarket(marketId, BigInt(agentId || '0'), scope(submission), account!);
            }}
            onClose={() => setApplyOpen(false)}
          />
        )}
        {identityOpen && <RegisterIdentityModal onClose={() => setIdentityOpen(false)} onRegistered={() => { setIdentityOpen(false); setApplyOpen(true); }} />}
      </div>
    </Section>
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
        <Command label="Submit milestone" disabled={!account} onDone={load}
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
          run={() => sdk.submitFinding(marketId, BigInt(agentId || '0'), scope(deliver), account!)} />
      </Card>
    </Section>
  );
}
