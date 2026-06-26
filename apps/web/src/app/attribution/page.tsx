'use client';

import { useState } from 'react';
import { Info, Users } from 'lucide-react';
import { AttributionType, CurveType, MAX_SLICE_BPS } from '@echo/sdk';
import { useEcho } from '@/lib/sdk';
import { Card, Field, Select, KV, Badge, Button, EmptyState, CARD_CLASS } from '@/components/ui';
import { Command } from '@/components/Command';
import { usdc, short } from '@/lib/format';

type ARView = { id: string; originator: string; sliceBps: number; confirmed: boolean; revoked: boolean; paidToDate: bigint };

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
  const [primary, setPrimary] = useState<string | null>(null);
  const [ars, setArs] = useState<ARView[] | null>(null);
  const [loadedFor, setLoadedFor] = useState('');

  async function loadWorkerARs() {
    const [ids, primaryRes] = await Promise.all([
      sdk.getWorkerARs(BigInt(workerAgentId)),
      sdk.primaryIntroducer(BigInt(workerAgentId)),
    ]);
    const [originator, exists] = primaryRes as [string, boolean];
    setPrimary(exists ? originator : null);
    const list = await Promise.all((ids as bigint[]).map(async (id) => {
      const ar: any = await sdk.getAR(id);
      return { id: id.toString(), originator: ar.originator, sliceBps: Number(ar.sliceBps), confirmed: ar.confirmed, revoked: ar.revoked, paidToDate: ar.paidToDate };
    }));
    setArs(list);
    setLoadedFor(workerAgentId);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-1">Introducer</h1>
      <p className="text-sm text-white/50 mb-6">
        Attribution Receipts (ARs) earn a slice (up to {MAX_SLICE_BPS / 100}%) of a worker&apos;s payouts once an independent requester who graded them confirms it.
      </p>

      <div className="mb-6 flex items-start gap-3 rounded-xl border border-teal-500/20 bg-teal-500/[0.06] px-4 py-3">
        <Info className="h-4 w-4 shrink-0 text-teal-400 mt-0.5" />
        <p className="text-sm text-white/70">
          <b className="font-semibold text-white">How the slice works:</b> if you introduced a worker, propose an
          AR naming a slice of their future payouts. A different requester who actually graded that worker then
          confirms it, this anti-sybil step proves you brought in real work, not just a self-dealt referral. Once
          confirmed, your slice pays out automatically on the worker&apos;s settlements until it decays, expires, or is revoked.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 mb-8">
        <Card title="Propose AR" hint="You become the originator, paid on each of the worker's settlements.">
          <div className="grid grid-cols-2 gap-1">
            <Field label="worker agentId" value={workerAgentId} onChange={(e) => setWorker(e.target.value)} />
            <Field label="slice bps (≤ 5000)" value={sliceBps} onChange={(e) => setSlice(e.target.value)} />
          </div>
          <p className="text-xs text-white/30">{sliceBps && !isNaN(Number(sliceBps)) ? `${(Number(sliceBps) / 100).toFixed(2)}% of the worker's payout` : ''}</p>
          <Select label="decay curve" value={curve} onChange={(e) => setCurve(e.target.value)}>
            <option value={CurveType.Linear}>Linear (decays)</option>
            <option value={CurveType.FlatPerpetual}>Flat perpetual</option>
            <option value={CurveType.VolumeCap}>Volume cap</option>
          </Select>
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

        <Card title="Confirm or revoke AR" hint="Confirming must come from an independent requester who graded the worker (anti-sybil).">
          <div className="grid grid-cols-2 gap-1">
            <Field label="AR id" value={arId} onChange={(e) => setArId(e.target.value)} />
            <Field label="confirming requester" value={confirmer} onChange={(e) => setConfirmer(e.target.value)} placeholder="0x…" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Command label="Confirm AR" disabled={!account || !confirmer} run={() => sdk.confirmAR(BigInt(arId), confirmer as `0x${string}`, account!)} />
            <Command label="Revoke AR" tone="danger" disabled={!account} run={() => sdk.revokeAR(BigInt(arId), account!)} />
          </div>
        </Card>
      </div>

      <section>
        <h2 className="text-lg font-bold text-white">Attribution receipts</h2>
        <p className="text-sm text-white/50 mt-0.5 mb-3">For the worker agentId entered above, there is no global AR listing on-chain.</p>
        <div className={CARD_CLASS}>
          <Button variant="secondary" disabled={!workerAgentId} onClick={loadWorkerARs}>Load worker&apos;s ARs</Button>

          {primary && (
            <p className="mt-3 text-xs text-white/40">Primary confirmed introducer: <span className="font-mono text-white">{short(primary)}</span></p>
          )}

          {ars && ars.length === 0 && (
            <div className="mt-2">
              <EmptyState icon={Users} title="No attribution receipts" desc={`Worker agentId ${loadedFor} has no proposed ARs yet.`} />
            </div>
          )}

          {ars && ars.length > 0 && (
            <ul className="mt-3 divide-y divide-white/[0.08]">
              {ars.map((ar) => (
                <li key={ar.id} className="flex items-center gap-3 py-2.5">
                  <span className="font-mono text-sm text-white/40 w-10">#{ar.id}</span>
                  <span className="flex-1 text-sm font-mono text-white truncate">{short(ar.originator)}</span>
                  <span className="text-sm font-mono text-teal-400">{(ar.sliceBps / 100).toFixed(2)}%</span>
                  <Badge tone={ar.revoked ? 'danger' : ar.confirmed ? 'success' : 'warning'}>
                    {ar.revoked ? 'revoked' : ar.confirmed ? 'confirmed' : 'awaiting confirm'}
                  </Badge>
                  <span className="text-xs text-white/40">${usdc(ar.paidToDate)} paid</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
