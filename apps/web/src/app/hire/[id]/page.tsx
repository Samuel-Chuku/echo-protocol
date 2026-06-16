'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { EchoMode, CONTRACTS } from '@echo/sdk';
import { useEcho } from '@/lib/sdk';
import { Section, Card, Field, KV } from '@/components/ui';
import { Command } from '@/components/Command';
import { usdc, toUnits, short, modeName, FINDING_STATUS, MILESTONE_STATUS } from '@/lib/format';

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

export default function ManageMarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { sdk, account } = useEcho();
  const [participant, setParticipant] = useState('');
  const [idx, setIdx] = useState('0');
  const [award, setAward] = useState('50');
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState('');

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
      setData({ mode, market, remaining: remaining as bigint, apps, findings, milestones, revealFee: revealFee as bigint, flagWindow: flagWindow as bigint });
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

        {/* Open/Reveal actions */}
        {data?.mode === EchoMode.OpenMarket && (
          <Card title="Open / Reveal actions" hint="reveal pays R + holds the stake; grade walks tiers; settle/flag resolve the held stake.">
            <Field label="participant address" value={participant} onChange={(e) => setParticipant(e.target.value)} placeholder="0x…" />
            <div className="flex flex-wrap gap-2">
              <Command label="Reveal" disabled={!account || !participant} onDone={load} run={() => sdk.reveal(marketId(), participant as `0x${string}`, account!)} />
              <Command label="Settle stake" tone="neutral" disabled={!account || !participant} onDone={load} run={() => sdk.settleRevealStake(marketId(), participant as `0x${string}`, account!)} />
            </div>
            <p className="text-xs text-gray-400">To flag a reveal as bait-and-switch, <Link href="/disputes" className="underline hover:text-gray-700">open a bonded stake dispute</Link>.</p>
            <div className="flex flex-wrap gap-2">
              <Command label="Grade Substantive" disabled={!account || !participant} onDone={load} run={() => sdk.gradeSubstantive(marketId(), participant as `0x${string}`, account!)} />
              <Command label="Grade Shortlist" disabled={!account || !participant} onDone={load} run={() => sdk.gradeShortlist(marketId(), participant as `0x${string}`, account!)} />
              <Command label="Grade Final" disabled={!account || !participant} onDone={load} run={() => sdk.gradeFinal(marketId(), participant as `0x${string}`, account!)} />
              <Command label="Trigger ghost" tone="neutral" disabled={!account || !participant} run={() => sdk.triggerGhost(marketId(), participant as `0x${string}`, account!)} />
            </div>
            {data.apps?.length > 0 && (
              <KV rows={data.apps.map((a: any) => [short(a.participant), `tier ${a.tierReached}`])} />
            )}
            <Command label="Close market" tone="neutral" disabled={!account} onDone={load} run={() => sdk.closeMarket(marketId(), account!)} />
          </Card>
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

      <AttributionOptIn sdk={sdk} account={account} marketId={marketId} />
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
