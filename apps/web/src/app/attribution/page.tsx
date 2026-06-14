'use client';

import { useState } from 'react';
import { AttributionType, CurveType, MAX_SLICE_BPS } from '@echo/sdk';
import { useEcho } from '@/lib/sdk';
import { Section, Card, Field, KV } from '@/components/ui';
import { Command } from '@/components/Command';
import { usdc, short } from '@/lib/format';

/**
 * Introducer console. Propose an Attribution Receipt against a worker, then (as a different requester
 * who graded them) confirm it so it starts earning a slice of that worker's payouts; revoke to stop.
 */
export default function AttributionPage() {
  const { sdk, account } = useEcho();

  const [workerAgentId, setWorker] = useState('');
  const [sliceBps, setSlice] = useState('1000');
  const [curve, setCurve] = useState(String(CurveType.Linear));
  const [durationDays, setDuration] = useState('1095');
  const [volumeCap, setCap] = useState('0');
  const [arId, setArId] = useState('1');
  const [confirmer, setConfirmer] = useState('');
  const [ar, setAr] = useState<any>(null);
  const [reads, setReads] = useState<[string, string][]>([]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Introducer</h1>
      <p className="text-sm text-gray-500 mb-6">Attribution Receipts earn a slice (≤ {MAX_SLICE_BPS / 100}%) of a worker&apos;s payouts once an independent grader confirms them.</p>

      <Section title="Manage attribution receipts">
        <Card title="Propose AR" hint="proposeAR — you become the originator paid on each of the worker's settlements.">
          <div className="grid grid-cols-2 gap-1">
            <Field label="worker agentId" value={workerAgentId} onChange={(e) => setWorker(e.target.value)} />
            <Field label="slice bps (≤5000)" value={sliceBps} onChange={(e) => setSlice(e.target.value)} />
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-500">curve</span>
            <select value={curve} onChange={(e) => setCurve(e.target.value)} className="mt-0.5 w-full px-2.5 py-1.5 text-sm rounded-md border border-gray-300">
              <option value={CurveType.Linear}>Linear (decays)</option>
              <option value={CurveType.FlatPerpetual}>Flat perpetual</option>
              <option value={CurveType.VolumeCap}>Volume cap</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-1">
            <Field label="duration (days)" value={durationDays} onChange={(e) => setDuration(e.target.value)} />
            <Field label="volume cap USDC" value={volumeCap} onChange={(e) => setCap(e.target.value)} />
          </div>
          <Command label="Propose AR" disabled={!account || !workerAgentId}
            run={() => sdk.proposeAR({
              workerAgentId: BigInt(workerAgentId),
              attributionType: AttributionType.Introduced,
              sliceBps: Number(sliceBps),
              curve: Number(curve),
              durationSecs: Number(durationDays) * 86400,
              volumeCap: BigInt(Math.round(Number(volumeCap) * 1e6)),
            }, account!)} />
        </Card>

        <Card title="Confirm / revoke AR" hint="confirmAR must come from an independent requester who graded the worker (anti-sybil).">
          <div className="grid grid-cols-2 gap-1">
            <Field label="AR id" value={arId} onChange={(e) => setArId(e.target.value)} />
            <Field label="confirming requester" value={confirmer} onChange={(e) => setConfirmer(e.target.value)} placeholder="0x…" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Command label="Confirm AR" disabled={!account || !confirmer} run={() => sdk.confirmAR(BigInt(arId), confirmer as `0x${string}`, account!)} />
            <Command label="Revoke AR" tone="danger" disabled={!account} run={() => sdk.revokeAR(BigInt(arId), account!)} />
          </div>
        </Card>

        <Card title="Reads">
          <div className="flex flex-wrap gap-2">
            <Command label="Load AR" tone="neutral" run={async () => { setAr(await sdk.getAR(BigInt(arId))); return 'loaded'; }} />
            <Command label="Worker ARs + primary" tone="neutral" disabled={!workerAgentId}
              run={async () => {
                const [ids, primary, count] = await Promise.all([
                  sdk.getWorkerARs(BigInt(workerAgentId)),
                  sdk.primaryIntroducer(BigInt(workerAgentId)),
                  sdk.arCount(),
                ]);
                const [originator, exists] = primary as [string, boolean];
                setReads([
                  ['total ARs', String(count)],
                  ['worker AR ids', (ids as bigint[]).map(String).join(', ') || '—'],
                  ['primary introducer', exists ? short(originator) : 'none confirmed'],
                ]);
                return 'loaded';
              }} />
          </div>
          {ar && (
            <KV rows={[
              ['originator', short(ar.originator)],
              ['slice bps', String(ar.sliceBps)],
              ['confirmed', String(ar.confirmed)],
              ['revoked', String(ar.revoked)],
              ['paid to date', usdc(ar.paidToDate)],
            ]} />
          )}
          {reads.length > 0 && <KV rows={reads} />}
        </Card>
      </Section>
    </div>
  );
}
