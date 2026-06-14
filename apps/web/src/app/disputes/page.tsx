'use client';

import { useEffect, useState } from 'react';
import { useEcho } from '@/lib/sdk';
import { Section, Card, Field, KV } from '@/components/ui';
import { Command } from '@/components/Command';
import { usdc, toUnits, short, scope } from '@/lib/format';

const SUBJECTS = ['BountyFinding', 'ModeAStake'] as const;
const STATUS = ['Open', 'Resolved'] as const;

/**
 * Adjudication console (DisputeResolver). Open a dispute (bounty finding rejection, or a Mode-A bait
 * flag), counter it, vote as a juror, resolve, and claim rewards. Bonds are USDC — approve
 * "→ Disputes" in the top bar first.
 */
export default function DisputesPage() {
  const { sdk, account } = useEcho();

  const [cfg, setCfg] = useState<{ minBond: bigint; votingPeriod: bigint; modeAStakeEnabled: boolean; jurorCount: bigint } | null>(null);
  const [marketId, setMarketId] = useState('1');
  const [findingIndex, setFindingIndex] = useState('0');
  const [participant, setParticipant] = useState('');
  const [bond, setBond] = useState('25');
  const [disputeId, setDisputeId] = useState('1');
  const [hint, setHint] = useState('looks-valid');
  const [d, setD] = useState<any>(null);

  async function loadCfg() { setCfg(await sdk.disputeConfig()); }
  useEffect(() => { loadCfg().catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const did = () => BigInt(disputeId || '0');

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Disputes</h1>
      <p className="text-sm text-gray-500 mb-6">The staked-jury rung. Approve USDC → Disputes (top bar) to cover bonds.</p>

      {cfg && (
        <div className="mb-6">
          <KV rows={[
            ['min bond', usdc(cfg.minBond)],
            ['voting period', `${Number(cfg.votingPeriod) / 86400}d`],
            ['ModeAStake enabled', String(cfg.modeAStakeEnabled)],
            ['jurors seated', String(cfg.jurorCount)],
          ]} />
          {cfg.jurorCount === 0n && (
            <p className="mt-2 text-xs text-amber-600">No jurors seated yet — disputes can be opened/countered but not voted/resolved until the owner runs setJuror().</p>
          )}
        </div>
      )}

      <Section title="Open a dispute">
        <Card title="Open finding dispute" hint="openFindingDispute — submitter contests a REJECTED bounty finding.">
          <div className="grid grid-cols-3 gap-1">
            <Field label="marketId" value={marketId} onChange={(e) => setMarketId(e.target.value)} />
            <Field label="finding idx" value={findingIndex} onChange={(e) => setFindingIndex(e.target.value)} />
            <Field label="bond USDC" value={bond} onChange={(e) => setBond(e.target.value)} />
          </div>
          <Command label="Open finding dispute" disabled={!account}
            run={() => sdk.openFindingDispute(BigInt(marketId), BigInt(findingIndex), toUnits(bond), account!)} />
        </Card>

        <Card title="Open stake dispute (flag)" hint="openStakeDispute — requester flags a revealed applicant's held stake as bait (P6).">
          <div className="grid grid-cols-2 gap-1">
            <Field label="marketId" value={marketId} onChange={(e) => setMarketId(e.target.value)} />
            <Field label="bond USDC" value={bond} onChange={(e) => setBond(e.target.value)} />
          </div>
          <Field label="participant" value={participant} onChange={(e) => setParticipant(e.target.value)} placeholder="0x…" />
          <Command label="Open stake dispute" tone="danger" disabled={!account || !participant}
            run={() => sdk.openStakeDispute(BigInt(marketId), participant as `0x${string}`, toUnits(bond), account!)} />
        </Card>
      </Section>

      <Section title="Lifecycle">
        <Card title="Counter / vote / resolve" hint="counter posts the matching bond; jurors vote; anyone resolves after the window.">
          <Field label="disputeId" value={disputeId} onChange={(e) => setDisputeId(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Command label="Counter" disabled={!account} run={() => sdk.counterDispute(did(), account!)} />
            <Command label="Vote: for opener" disabled={!account} run={() => sdk.voteDispute(did(), true, account!)} />
            <Command label="Vote: against" tone="neutral" disabled={!account} run={() => sdk.voteDispute(did(), false, account!)} />
            <Command label="Resolve" disabled={!account} onDone={() => sdk.getDispute(did()).then(setD)} run={() => sdk.resolveDispute(did(), account!)} />
            <Command label="Claim reward" tone="neutral" disabled={!account} run={() => sdk.claimJurorReward(did(), account!)} />
          </div>
        </Card>

        <Card title="Agent hint / inspect" hint="recordAgentHint is the non-binding rung-1 advisory (oracle only).">
          <div className="grid grid-cols-2 gap-1">
            <Field label="disputeId" value={disputeId} onChange={(e) => setDisputeId(e.target.value)} />
            <Field label="hint text → hash" value={hint} onChange={(e) => setHint(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Command label="Record hint" tone="neutral" disabled={!account} run={() => sdk.recordAgentHint(did(), scope(hint), account!)} />
            <Command label="Load dispute" tone="neutral" run={async () => { setD(await sdk.getDispute(did())); return 'loaded'; }} />
          </div>
          {d && (
            <KV rows={[
              ['subject', SUBJECTS[Number(d.subject)] ?? String(d.subject)],
              ['status', STATUS[Number(d.status)] ?? String(d.status)],
              ['market', String(d.marketId)],
              ['opener', short(d.opener)],
              ['counter', short(d.counter)],
              ['bond', usdc(d.bond)],
              ['for / against', `${d.forOpener} / ${d.against}`],
            ]} />
          )}
        </Card>
      </Section>
    </div>
  );
}
