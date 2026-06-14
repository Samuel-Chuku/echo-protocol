'use client';

import { useState } from 'react';
import { EchoMode } from '@echo/sdk';
import { useEcho } from '@/lib/sdk';
import { useAgent } from '@/lib/agent';
import { Section, Card, Field, KV } from '@/components/ui';
import { Command } from '@/components/Command';
import { usdc, toUnits, scope, short, modeName, FINDING_STATUS, MILESTONE_STATUS } from '@/lib/format';

/**
 * Requester console. Create every market shape, then manage one by id: fund attribution, reveal
 * applicants + resolve their held stake (P6), grade tiers, drive Mode-B milestones / Bounty findings,
 * close, and trigger ghost. Every button is a live SDK call. Approve USDC in the top bar first.
 */
export default function HirePage() {
  const { sdk, account } = useEcho();
  const { agentId } = useAgent();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Requester</h1>
      <p className="text-sm text-gray-500 mb-6">Create markets and run their lifecycle. requesterAgentId defaults to your registered agentId ({agentId || '—'}).</p>
      <CreateMarkets sdk={sdk} account={account} agentId={agentId} />
      <ManageMarket sdk={sdk} account={account} />
    </div>
  );
}

/* ──────────────────────────── create ──────────────────────────── */

function CreateMarkets({ sdk, account, agentId }: { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; agentId: string }) {
  // shared market knobs
  const [tiers, setTiers] = useState(['5', '50', '250', '1000']); // USDC: reveal/substantive, shortlist, final, ghost
  const [escrow, setEscrow] = useState('2000');
  const [maxApplicants, setMax] = useState('50');
  const [ghostDays, setGhostDays] = useState('7');
  // reveal/stake
  const [stake, setStake] = useState('10');
  const [flagDays, setFlagDays] = useState('2');
  const [requiredProofs, setProofs] = useState('0');
  // direct job
  const [worker, setWorker] = useState('');
  const [workerAgentId, setWorkerAgentId] = useState('');
  const [milestones, setMilestones] = useState('100,200,300');
  const [reviewDays, setReviewDays] = useState('3');
  // bounty
  const [pool, setPool] = useState('1000');
  const [defaultAward, setDefaultAward] = useState('50');

  const tierAmounts = () => tiers.map(toUnits) as unknown as [bigint, bigint, bigint, bigint];
  const reqId = () => BigInt(agentId || '0');
  const need = !account || !agentId;

  return (
    <Section title="Create market" desc="Pick a shape. Open/Reveal and DirectJob/Bounty have distinct entrypoints.">
      <Card title="Open / Reveal market" hint="createMarketWithMode — tier[0] is the reveal fee R; set stake+flag window for a reveal market.">
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
        <Command label="Create market" disabled={need}
          run={() => sdk.createMarketWithMode({
            metadataURI: 'ipfs://console-market',
            scopeHash: scope('console-scope'),
            tierAmounts: tierAmounts(),
            minPRep: 0n,
            maxApplicants: BigInt(maxApplicants),
            ghostDeadline: BigInt(Number(ghostDays) * 86400),
            escrowTotal: toUnits(escrow),
            requesterAgentId: reqId(),
            cfg: {
              mode: EchoMode.OpenMarket,
              requiredProofs: BigInt(requiredProofs),
              stakeRequired: toUnits(stake),
              flagWindow: BigInt(Number(flagDays) * 86400),
            },
          }, account!)} />
        {need && <p className="text-xs text-amber-600">Connect + register an agentId first.</p>}
      </Card>

      <Card title="Direct Job (Mode B)" hint="createDirectJob — two known parties, milestone escrow.">
        <Field label="worker address" value={worker} onChange={(e) => setWorker(e.target.value)} placeholder="0x…" />
        <div className="grid grid-cols-2 gap-1">
          <Field label="worker agentId" value={workerAgentId} onChange={(e) => setWorkerAgentId(e.target.value)} />
          <Field label="review (days)" value={reviewDays} onChange={(e) => setReviewDays(e.target.value)} />
        </div>
        <Field label="milestone amounts (USDC, comma)" value={milestones} onChange={(e) => setMilestones(e.target.value)} />
        <Command label="Create direct job" disabled={need || !worker}
          run={() => sdk.createDirectJob({
            worker: worker as `0x${string}`,
            workerAgentId: BigInt(workerAgentId || '0'),
            requesterAgentId: reqId(),
            metadataURI: 'ipfs://console-job',
            scopeHash: scope('console-job'),
            milestoneAmounts: milestones.split(',').map((s) => toUnits(s.trim())),
            reviewWindow: BigInt(Number(reviewDays) * 86400),
          }, account!)} />
      </Card>

      <Card title="Bounty" hint="createBounty — open submissions, parallel winners.">
        <div className="grid grid-cols-2 gap-1">
          <Field label="pool USDC" value={pool} onChange={(e) => setPool(e.target.value)} />
          <Field label="default award USDC" value={defaultAward} onChange={(e) => setDefaultAward(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Field label="review (days)" value={reviewDays} onChange={(e) => setReviewDays(e.target.value)} />
          <Field label="requiredProofs" value={requiredProofs} onChange={(e) => setProofs(e.target.value)} />
        </div>
        <Command label="Create bounty" disabled={need}
          run={() => sdk.createBounty({
            requesterAgentId: reqId(),
            metadataURI: 'ipfs://console-bounty',
            scopeHash: scope('console-bounty'),
            requiredProofs: BigInt(requiredProofs),
            defaultAward: toUnits(defaultAward),
            reviewWindow: BigInt(Number(reviewDays) * 86400),
            pool: toUnits(pool),
          }, account!)} />
      </Card>
    </Section>
  );
}

/* ──────────────────────────── manage ──────────────────────────── */

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

function ManageMarket({ sdk, account }: { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}` }) {
  const [id, setId] = useState('1');
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

  return (
    <Section title="Manage a market" desc="Load by id, then drive its lifecycle. Actions are gated by the market's mode.">
      <Card title="Load market">
        <Field label="marketId" value={id} onChange={(e) => setId(e.target.value)} />
        <Command label="Load" tone="neutral" run={load} onDone={() => {}} />
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
          <p className="text-xs text-gray-400">To flag a reveal as bait-and-switch, open a bonded stake dispute on the Disputes tab.</p>
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

      <Card title="Fund attribution pool" hint="fundAttributionPool — rewards introducers of advancing workers from your escrow.">
        <div className="grid grid-cols-2 gap-1">
          <Field label="amount USDC" value={award} onChange={(e) => setAward(e.target.value)} />
          <Field label="introducer share bps" value={idx} onChange={(e) => setIdx(e.target.value)} />
        </div>
        <Command label="Fund pool" tone="neutral" disabled={!account} run={() => sdk.fundAttributionPool(marketId(), toUnits(award), Number(idx), account!)} />
      </Card>
    </Section>
  );
}
