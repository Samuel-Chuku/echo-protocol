'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Briefcase, Lock, Plus, Trash2 } from 'lucide-react';
import { useQuery, gql } from 'urql';
import { useAccount } from 'wagmi';
import { EchoMode, buildMetadata, CONTRACTS } from '@echo/sdk';
import { useEcho } from '@/lib/sdk';
import { useAgent } from '@/lib/agent';
import { useFlag } from '@/lib/flags';
import { Card, Field, TextArea, Badge, Button, EmptyState, CARD_CLASS, ProgressSteps, TierTrack, InfoTip, type TierStep } from '@/components/ui';
import { IdentityBanner } from '@/components/IdentityBanner';
import { RegisterIdentityModal } from '@/components/RegisterIdentityModal';
import { TxModal } from '@/components/TxModal';
import { toUnits, usdc, scope, modeName, modeBadgeTone, MODE_BLURBS, recommendedEscrow, minEscrow } from '@/lib/format';
import { provisionAgentWallet, createAgentMarket } from '@/lib/agentApi';

const C = CONTRACTS.arcTestnet;
const TYPE_ACCENT = ['border-teal-500/30 hover:border-teal-500/50', 'border-success/30 hover:border-success/50', 'border-warning/30 hover:border-warning/50'];

/**
 * Requester home. Pick a market type, walk a 3-step wizard (details -> structure -> review & deploy).
 */
export default function HirePage() {
  const { sdk, account } = useEcho();
  const { agentId } = useAgent();
  const [feeBps, setFeeBps] = useState<bigint>();
  const [createdAt, setCreatedAt] = useState(0);

  useEffect(() => { sdk.protocolFeeBps().then((b) => setFeeBps(b as bigint)).catch(() => {}); }, [sdk]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-1">Post a job</h1>
      <p className="text-sm text-white/50 mb-6">Create work, then manage it. Your identity: agentId {agentId || '—'}.</p>
      <IdentityBanner />
      <CreateMarket sdk={sdk} account={account} agentId={agentId} feeBps={feeBps} onCreated={() => setCreatedAt(Date.now())} />
      <MyMarkets account={account} createdAt={createdAt} />
    </div>
  );
}

/* ──────────────────────────── create: type picker → wizard ──────────────────────────── */

function CreateMarket({ sdk, account, agentId, feeBps, onCreated }: {
  sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`;
  agentId: string; feeBps?: bigint; onCreated: () => void;
}) {
  const [type, setType] = useState<EchoMode | null>(null);
  const paused = useFlag('web.pauseMarketCreation');

  const pausedNotice = paused && (
    <p className="text-xs text-warning bg-warning/10 border border-warning/20 rounded-md px-3 py-2 mb-3">
      New market creation is temporarily paused by the operator. Existing markets are unaffected.
    </p>
  );

  if (type === null) {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-bold text-white">Create work</h2>
        <p className="text-sm text-white/50 mt-0.5 mb-3">Pick the shape that fits. You can manage it below once it&apos;s live.</p>
        {pausedNotice}
        <div className="grid gap-4 sm:grid-cols-3">
          {[EchoMode.OpenMarket, EchoMode.DirectJob, EchoMode.Bounty].map((m) => (
            <button
              key={m}
              onClick={() => setType(m)}
              className={`text-left p-5 rounded-card border bg-white/[0.03] transition ${TYPE_ACCENT[m]}`}
            >
              <Badge tone={modeBadgeTone(m)}>{modeName(m)}</Badge>
              <p className="mt-3 text-sm text-white/60">{MODE_BLURBS[m]}</p>
              <span className="mt-3 inline-block text-sm font-medium text-teal-400">Choose</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <button onClick={() => setType(null)} className="text-xs text-white/40 hover:text-white transition mb-3">Back to type picker</button>
      {pausedNotice}
      {type === EchoMode.OpenMarket && <OpenWizard sdk={sdk} account={account} agentId={agentId} feeBps={feeBps} onCreated={onCreated} />}
      {type === EchoMode.DirectJob && <DirectWizard sdk={sdk} account={account} agentId={agentId} feeBps={feeBps} onCreated={onCreated} />}
      {type === EchoMode.Bounty && <BountyWizard sdk={sdk} account={account} agentId={agentId} feeBps={feeBps} onCreated={onCreated} />}
    </section>
  );
}

type WizardProps = { sdk: ReturnType<typeof useEcho>['sdk']; account?: `0x${string}`; agentId: string; feeBps?: bigint; onCreated?: () => void };

function feeOn(amountHuman: string, feeBps?: bigint) {
  if (feeBps === undefined) return '...';
  const amt = Number(amountHuman || '0');
  return (amt * Number(feeBps) / 10000).toFixed(2);
}

function IdentityGate({ agentId, onOk }: { agentId: string; onOk: () => void }) {
  const [open, setOpen] = useState(false);
  const paused = useFlag('web.pauseMarketCreation');
  return (
    <>
      <Button disabled={paused} onClick={() => (agentId ? onOk() : setOpen(true))}>Approve &amp; deploy</Button>
      {paused && <p className="text-xs text-warning mt-1">Market creation is paused by the operator.</p>}
      {open && <RegisterIdentityModal onClose={() => setOpen(false)} onRegistered={onOk} />}
    </>
  );
}

/* Duration input: minutes / hours / days, converts to seconds at submit */
type DurationUnit = 'minutes' | 'hours' | 'days';
const UNIT_SECONDS: Record<DurationUnit, number> = { minutes: 60, hours: 3600, days: 86400 };
const toSeconds = (amount: string, unit: DurationUnit): number => Math.max(0, Math.round(Number(amount || '0') * UNIT_SECONDS[unit]));

function DurationField({ label, amount, unit, onAmount, onUnit, hint, tip }: {
  label: string; amount: string; unit: DurationUnit; onAmount: (v: string) => void; onUnit: (u: DurationUnit) => void; hint?: string; tip?: ReactNode;
}) {
  return (
    <label className="block" title={hint}>
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-white/40">
        {label}
        {tip && <InfoTip text={tip} label={label} />}
      </span>
      <div className="mt-0.5 flex gap-1">
        <input
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
          className="flex-1 min-w-0 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-sm text-white focus:border-teal-500/50 focus:outline-none"
        />
        <select
          value={unit}
          onChange={(e) => onUnit(e.target.value as DurationUnit)}
          className="rounded-md border border-white/10 bg-[#0d2d4a] px-2 py-1.5 text-sm text-white focus:border-teal-500/50 focus:outline-none"
        >
          <option value="minutes">min</option>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
      </div>
    </label>
  );
}

/** Market type is picked once on the type-grid; show it as a locked, non-editable badge inside the wizard. */
function LockedTypeBadge({ mode }: { mode: EchoMode }) {
  return (
    <div className="flex items-center gap-1.5 mb-4">
      <Badge tone={modeBadgeTone(mode)}>{modeName(mode)}</Badge>
      <span className="inline-flex items-center gap-1 text-xs text-white/30">
        <Lock className="w-3 h-3" /> locked
      </span>
    </div>
  );
}

/** One rung of the payout ladder: a named amount with a "?" tip and a plain-language sub-line, plus a
 *  compact USD input. Used for reveal fee / shortlist / final / ghost so each has room to be explained. */
function LadderField({ label, value, onChange, tip, desc }: {
  label: string; value: string; onChange: (v: string) => void; tip: ReactNode; desc: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2">
      <div className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1 text-sm font-medium text-white/80">
          {label}
          <InfoTip text={tip} label={label} />
        </span>
        <p className="text-[11px] text-white/40 leading-tight">{desc}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-xs text-white/40">$</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          className="w-20 rounded-md border border-white/10 bg-white/[0.05] px-2 py-1.5 text-sm text-right font-mono text-white focus:border-teal-500/40 focus:outline-none"
        />
      </div>
    </div>
  );
}

/** Live running total + platform fee, recalculated on every keystroke in the tier/payout step. */
function LiveTotal({ label, totalHuman, feeBps }: { label: string; totalHuman: string; feeBps?: bigint }) {
  return (
    <div className="rounded-lg border border-teal-500/20 bg-teal-500/[0.05] p-3 text-sm space-y-1.5">
      <div className="flex justify-between"><span className="text-white/50">{label}</span><span className="font-mono text-white">${totalHuman} USDC</span></div>
      <div className="flex justify-between"><span className="text-white/50">Platform fee{feeBps !== undefined ? ` (${Number(feeBps) / 100}% on payouts)` : ' on payouts'}</span><span className="font-mono text-teal-400">${feeOn(totalHuman, feeBps)} USDC est.</span></div>
    </div>
  );
}

function OpenWizard({ sdk, account, agentId, feeBps, onCreated }: WizardProps) {
  const [step, setStep] = useState(0);
  const [subject, setSubject] = useState('');
  const [desc, setDesc] = useState('');
  const [tiers, setTiers] = useState(['5', '50', '250', '1000']);
  const [maxApplicants, setMax] = useState('50');
  // Escrow auto-tracks the inputs (recommendedEscrow = safe upper bound) until the requester edits it
  // manually, at which point we respect their number. `escrowTouched` flips on first manual edit.
  const [escrow, setEscrow] = useState('');
  const [escrowTouched, setEscrowTouched] = useState(false);
  const [ghostAmount, setGhostAmount] = useState('7');
  const [ghostUnit, setGhostUnit] = useState<DurationUnit>('days');
  const [stake, setStake] = useState('10');
  const [flagAmount, setFlagAmount] = useState('2');
  const [flagUnit, setFlagUnit] = useState<DurationUnit>('days');
  const [requiredProofs, setProofs] = useState('0');
  const [deployOpen, setDeployOpen] = useState(false);

  // AI agent (#4): opt in to let an autonomous agent (its own Circle wallet) screen previews, reveal,
  // and advance to shortlist per the criteria below. The market is created FROM the agent's wallet.
  const [agentMode, setAgentMode] = useState(false);
  const [agentWallet, setAgentWallet] = useState<{ walletId: string; address: string } | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [revealCriteria, setRevealCriteria] = useState('');
  const [advanceGuardrails, setAdvanceGuardrails] = useState('');
  const [agentMaxReveals, setAgentMaxReveals] = useState('10');
  const [agentMaxAdvances, setAgentMaxAdvances] = useState('5');
  const [agentThreshold, setAgentThreshold] = useState('60');
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentErr, setAgentErr] = useState<string | null>(null);
  const [agentResult, setAgentResult] = useState<{ marketId: number; txHash: string } | null>(null);

  const tierUnits = tiers.map((t) => toUnits(t || '0')) as [bigint, bigint, bigint, bigint];
  const nApplicants = BigInt(Math.max(0, Math.floor(Number(maxApplicants || '0'))));
  const recommended = recommendedEscrow(tierUnits, nApplicants);
  const minRequired = minEscrow(tierUnits, nApplicants);
  // The number the market is actually funded with: the auto-recommendation until manually overridden.
  const totalEscrow = escrowTouched ? (escrow || '0') : usdc(recommended);
  const escrowUnits = toUnits(totalEscrow);
  const belowMin = escrowUnits < minRequired;

  const tierSteps: TierStep[] = tiers.map((t, i) => ({ label: ['Reveal', 'Shortlist', 'Final', 'Ghost'][i], amount: t }));
  const tierTotal = usdc(tiers.reduce((sum, t) => sum + toUnits(t || '0'), 0n));

  return (
    <div className={`${CARD_CLASS} max-w-2xl`}>
      <LockedTypeBadge mode={EchoMode.OpenMarket} />
      <ProgressSteps steps={['Details', 'Payout ladder', 'Rules & timing', 'Review']} current={step} />

      {/* Step 0 — what the job is */}
      {step === 0 && (
        <div className="space-y-3">
          <p className="text-xs text-white/50">A <b className="text-white/70">reveal market</b> takes many hidden applications, then you unlock, grade, and advance the best ones round by round — paying more at each round.</p>
          <Field label="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What workers see in browse" />
          <TextArea label="description" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Scope / terms" rows={4} />
          <label className="flex items-start gap-2 rounded-lg border border-teal-500/20 bg-teal-500/[0.04] p-3 cursor-pointer">
            <input type="checkbox" checked={agentMode} onChange={(e) => setAgentMode(e.target.checked)} className="mt-0.5 accent-teal-500" />
            <span className="text-xs text-white/70">
              <b className="text-teal-300">🤖 Run with an AI agent.</b> An autonomous agent (its own Circle wallet) screens
              applicants&apos; public previews, reveals the promising ones for you, and auto-advances those clearly meeting
              your guardrails — the rest it ranks for your review. You set the criteria + spend caps next.
            </span>
          </label>
          <Button onClick={() => setStep(1)} disabled={!subject}>Next: payout ladder</Button>
        </div>
      )}

      {/* Step 1 — the payout ladder (the 4 tier amounts) with plain-language meaning (#3) */}
      {step === 1 && (
        <div className="space-y-3">
          <p className="text-xs text-white/50">Set what each round pays. Applicants climb the ladder as you advance them — you only pay a round when you advance someone into it.</p>
          <div className="space-y-1.5">
            <LadderField label="Reveal fee" value={tiers[0]} onChange={(v) => setTiers(tiers.map((x, j) => (j === 0 ? v : x)))}
              tip="The fee YOU pay to unlock and read one applicant's hidden submission. Set to 0 for no paid reveal — you grade applications directly instead."
              desc="You pay this to unlock a hidden application. 0 = no paid reveal." />
            <LadderField label="Shortlist payout" value={tiers[1]} onChange={(v) => setTiers(tiers.map((x, j) => (j === 1 ? v : x)))}
              tip="Paid to an applicant the moment you advance them into the shortlist round."
              desc="Paid to an applicant when you advance them to the shortlist." />
            <LadderField label="Final payout" value={tiers[2]} onChange={(v) => setTiers(tiers.map((x, j) => (j === 2 ? v : x)))}
              tip="Paid to an applicant when you advance them into the final round."
              desc="Paid to an applicant when you advance them to the final round." />
            <LadderField label="Ghost reserve" value={tiers[3]} onChange={(v) => setTiers(tiers.map((x, j) => (j === 3 ? v : x)))}
              tip="Held in reserve for the finalist. Pays them on delivery; if they vanish past the ghost deadline, it covers the penalty and refunds to you on close."
              desc="Reserved for the finalist — pays on delivery, or covers a no-show." />
          </div>
          <LiveTotal label="One applicant's full journey" totalHuman={tierTotal} feeBps={feeBps} />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(0)}>Back</Button>
            <Button onClick={() => setStep(2)}>Next: rules &amp; timing</Button>
          </div>
        </div>
      )}

      {/* Step 2 — rules & timing (escrow, stake, deadlines) — each carries a plain-language tooltip (#3/#5) */}
      {step === 2 && (
        <div className="space-y-3">
          <p className="text-xs text-white/50">Fund the market and set the rules. Hover any <span className="text-teal-400">?</span> for a plain-language explanation.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            <Field label="max applicants" value={maxApplicants} onChange={(e) => setMax(e.target.value)}
              tip="The most workers that can apply to this market. Escrow is sized from this." />
            <Field label="escrow USDC" value={totalEscrow}
              onChange={(e) => { setEscrowTouched(true); setEscrow(e.target.value); }}
              tip="Total USDC locked up front to fund every payout and reserve. Auto-filled to cover every applicant through every round; edit to override. Unspent escrow refunds to you when you close the market." />
          </div>

          {/* Escrow is auto-computed from the payout ladder × max applicants; show the math + the hard
              floor so the requester never hits an opaque InsufficientEscrow revert (#2). */}
          <div className={`rounded-lg border p-3 text-xs space-y-1 ${belowMin ? 'border-danger/40 bg-danger/[0.06]' : 'border-white/10 bg-white/[0.03]'}`}>
            <div className="flex justify-between"><span className="text-white/50">Recommended (covers everyone, every round)</span><span className="font-mono text-white/80">${usdc(recommended)}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Contract minimum</span><span className="font-mono text-white/60">${usdc(minRequired)}</span></div>
            {escrowTouched && (
              <button type="button" onClick={() => { setEscrowTouched(false); setEscrow(''); }} className="text-teal-400 hover:underline">
                Reset to recommended (${usdc(recommended)})
              </button>
            )}
            {belowMin
              ? <p className="text-danger">Below the contract minimum — deploy will revert. Raise escrow to at least ${usdc(minRequired)}.</p>
              : <p className="text-white/40">Unspent escrow refunds to you on close, so over-funding only locks capital — it&apos;s never lost.</p>}
          </div>

          {/* #5 — the applicant stake, explained clearly */}
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
            <Field label="applicant stake USDC (0 = none)" value={stake} onChange={(e) => setStake(e.target.value)}
              tip="USDC each applicant deposits to apply. It's HELD, not spent — refunded in full if they withdraw before you reveal them; forfeited to you only if you reveal them and they then fail to deliver. Deters spam applications." />
            <p className="text-xs text-white/40">
              Each applicant deposits this to apply — it&apos;s <b className="text-white/60">held, not spent</b>. Refunded if they
              withdraw before you reveal them; forfeited to you if you reveal them and they ghost. Set <b className="text-white/60">0</b> for no stake.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            <DurationField label="ghost deadline" amount={ghostAmount} unit={ghostUnit} onAmount={setGhostAmount} onUnit={setGhostUnit}
              tip="After you advance someone to the final round, how long they have to deliver before you can trigger the ghost penalty." />
            <DurationField label="flag window" amount={flagAmount} unit={flagUnit} onAmount={setFlagAmount} onUnit={setFlagUnit}
              tip="After you reveal an applicant, how long their stake stays held before it can be settled. It's your window to flag a bait-and-switch (a submission that doesn't match what was revealed)." />
          </div>
          <Field label="required proofs (0 = none)" value={requiredProofs} onChange={(e) => setProofs(e.target.value)}
            tip="Minimum ERC-8004 validation proofs an applicant's identity must carry to apply. 0 = anyone registered can apply." />

          {/* AI agent setup — only when agent mode is on. Provision the DCW, fund it, set criteria + caps. */}
          {agentMode && (
            <div className="rounded-lg border border-teal-500/25 bg-teal-500/[0.05] p-3 space-y-3">
              <p className="text-sm font-semibold text-teal-300">🤖 AI agent setup</p>
              {!agentWallet ? (
                <div className="space-y-1.5">
                  <p className="text-xs text-white/50">Provision the agent&apos;s Circle wallet — it becomes this market&apos;s owner and pays reveal gas from its balance.</p>
                  <Button variant="secondary" busy={provisioning} onClick={async () => {
                    setProvisioning(true); setAgentErr(null);
                    try { setAgentWallet(await provisionAgentWallet()); }
                    catch (e) { setAgentErr(e instanceof Error ? e.message : 'provision failed'); }
                    finally { setProvisioning(false); }
                  }}>Provision agent wallet</Button>
                </div>
              ) : (
                <div className="rounded-md border border-white/10 bg-white/[0.03] p-2 text-xs">
                  <span className="text-white/50">Agent wallet: </span>
                  <span className="font-mono text-white break-all">{agentWallet.address}</span>
                  <p className="mt-1 text-warning">Fund this address with USDC (escrow ${totalEscrow} + a little for gas) before creating the market.</p>
                </div>
              )}
              <TextArea label="reveal criteria — what makes a preview worth revealing" value={revealCriteria}
                onChange={(e) => setRevealCriteria(e.target.value)} rows={2}
                placeholder="e.g. Applicant clearly has video-editing experience and mentions relevant tools/portfolio." />
              <TextArea label="advancement guardrails — the STRINGENT bar to auto-advance to shortlist" value={advanceGuardrails}
                onChange={(e) => setAdvanceGuardrails(e.target.value)} rows={2}
                placeholder="e.g. Only advance if the full submission shows a concrete plan AND a relevant sample. If unsure, do not advance." />
              <div className="grid grid-cols-3 gap-1">
                <Field label="max reveals" value={agentMaxReveals} onChange={(e) => setAgentMaxReveals(e.target.value)} tip="Cap on how many applicants the agent may reveal (bounds spend)." />
                <Field label="max advances" value={agentMaxAdvances} onChange={(e) => setAgentMaxAdvances(e.target.value)} tip="Cap on how many the agent may auto-advance to shortlist." />
                <Field label="reveal score ≥" value={agentThreshold} onChange={(e) => setAgentThreshold(e.target.value)} tip="Minimum 0-100 preview score to reveal." />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
            <Button onClick={() => setStep(3)}>Next: review</Button>
          </div>
        </div>
      )}

      {/* Step 3 — review & deploy */}
      {step === 3 && (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-white mb-2">{subject}</p>
            <TierTrack steps={tierSteps} />
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-white/50">Escrow to lock</span><span className="font-mono text-white">${totalEscrow} USDC</span></div>
            <div className="flex justify-between"><span className="text-white/50">Platform fee (on payouts)</span><span className="font-mono text-white/70">${feeOn(totalEscrow, feeBps)} USDC est.</span></div>
            <div className="flex justify-between"><span className="text-white/50">Max applicants</span><span className="font-mono text-white">{maxApplicants}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Applicant stake</span><span className="font-mono text-white">{Number(stake) > 0 ? `$${stake} USDC` : 'none'}</span></div>
          </div>
          {belowMin && (
            <p className="text-xs text-danger">Escrow ${totalEscrow} is below the contract minimum ${usdc(minRequired)} — raise it on the previous step before deploying.</p>
          )}
          {agentMode && (
            <div className="rounded-lg border border-teal-500/20 bg-teal-500/[0.05] p-3 text-xs text-white/60 space-y-0.5">
              <p className="text-teal-300 font-semibold">🤖 Agent-run market</p>
              <p>The agent&apos;s wallet ({agentWallet ? `${agentWallet.address.slice(0, 10)}…` : 'not provisioned'}) creates + owns this market. Fund it first.</p>
            </div>
          )}
          {agentErr && <p className="text-xs text-danger break-all">{agentErr}</p>}
          {agentResult && <p className="text-xs text-success">Agent market #{agentResult.marketId} created. The agent will start screening applicants.</p>}
          <div className="flex gap-2 items-center">
            <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
            {belowMin ? (
              <Button disabled>Deploy</Button>
            ) : agentMode ? (
              <Button
                busy={agentBusy}
                disabled={!agentWallet || !revealCriteria.trim() || !advanceGuardrails.trim() || !!agentResult}
                onClick={async () => {
                  setAgentBusy(true); setAgentErr(null);
                  try {
                    const res = await createAgentMarket({
                      walletId: agentWallet!.walletId,
                      walletAddress: agentWallet!.address,
                      market: {
                        subject, description: desc,
                        tierAmounts: tiers.map((t) => toUnits(t).toString()) as [string, string, string, string],
                        escrowTotal: toUnits(totalEscrow).toString(),
                        maxApplicants: Number(maxApplicants),
                        ghostDeadline: toSeconds(ghostAmount, ghostUnit),
                        requiredProofs: Number(requiredProofs),
                        stakeRequired: toUnits(stake).toString(),
                        flagWindow: toSeconds(flagAmount, flagUnit),
                      },
                      agent: {
                        revealCriteria, advanceGuardrails,
                        maxReveals: Number(agentMaxReveals), maxAdvances: Number(agentMaxAdvances),
                        revealThreshold: Number(agentThreshold),
                      },
                    });
                    setAgentResult(res); onCreated?.();
                  } catch (e) {
                    setAgentErr(e instanceof Error ? e.message : 'create failed');
                  } finally { setAgentBusy(false); }
                }}
              >Create agent market</Button>
            ) : (
              <IdentityGate agentId={agentId} onOk={() => setDeployOpen(true)} />
            )}
          </div>
        </div>
      )}

      {deployOpen && (
        <TxModal
          title="Deploy Open / Reveal market"
          description={`Approves $${totalEscrow} USDC to the market, then creates it.`}
          confirmLabel="Approve & deploy"
          run={async () => {
            await sdk.ensureUsdcAllowance(C.marketRegistry, toUnits(totalEscrow), account!);
            return sdk.createMarketWithMode({
              metadataURI: buildMetadata({ subject, description: desc }),
              scopeHash: scope(subject || 'console-scope'),
              tierAmounts: tiers.map(toUnits) as unknown as [bigint, bigint, bigint, bigint],
              minPRep: 0n,
              maxApplicants: BigInt(maxApplicants),
              ghostDeadline: BigInt(toSeconds(ghostAmount, ghostUnit)),
              escrowTotal: toUnits(totalEscrow),
              requesterAgentId: BigInt(agentId || '0'),
              cfg: {
                mode: EchoMode.OpenMarket,
                requiredProofs: BigInt(requiredProofs),
                stakeRequired: toUnits(stake),
                flagWindow: BigInt(toSeconds(flagAmount, flagUnit)),
              },
            }, account!);
          }}
          onDone={() => { onCreated?.(); setDeployOpen(false); setStep(0); setSubject(''); setDesc(''); }}
          onClose={() => setDeployOpen(false)}
        />
      )}
    </div>
  );
}

function DirectWizard({ sdk, account, agentId, feeBps, onCreated }: WizardProps) {
  const [step, setStep] = useState(0);
  const [subject, setSubject] = useState('');
  const [desc, setDesc] = useState('');
  const [worker, setWorker] = useState('');
  const [workerAgentId, setWorkerAgentId] = useState('');
  const [milestones, setMilestones] = useState(['100', '200', '300']);
  const [reviewDays, setReviewDays] = useState('3');
  const [deployOpen, setDeployOpen] = useState(false);

  const amounts = () => milestones.map((s) => toUnits(s.trim() || '0'));
  const total = () => amounts().reduce((a, b) => a + b, 0n);
  const totalHuman = usdc(total());

  return (
    <div className={`${CARD_CLASS} max-w-2xl`}>
      <LockedTypeBadge mode={EchoMode.DirectJob} />
      <ProgressSteps steps={['Details', 'Milestones', 'Review & deploy']} current={step} />

      {step === 0 && (
        <div className="space-y-3">
          <Field label="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Job title" />
          <TextArea label="description" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Scope / terms" rows={4} />
          <Field label="worker address" value={worker} onChange={(e) => setWorker(e.target.value)} placeholder="0x…" />
          <Field label="worker agentId" value={workerAgentId} onChange={(e) => setWorkerAgentId(e.target.value)} />
          <Button onClick={() => setStep(1)} disabled={!subject || !worker}>Next: milestones</Button>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-xs text-white/40">One row per milestone. Each pays out in order as the worker delivers.</p>
          <div className="space-y-1.5">
            {milestones.map((amt, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-500/10 text-teal-400 text-xs font-bold">{i + 1}</span>
                <input
                  value={amt}
                  onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? e.target.value : x)))}
                  placeholder="USDC amount"
                  className="flex-1 px-3 py-2 text-sm rounded-lg bg-white/[0.05] border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-teal-500/40 transition-colors"
                />
                <button
                  onClick={() => setMilestones(milestones.filter((_, j) => j !== i))}
                  disabled={milestones.length <= 1}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/40 hover:text-danger hover:bg-danger/10 disabled:opacity-30 disabled:hover:bg-transparent transition"
                  aria-label="Remove milestone"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setMilestones([...milestones, '100'])}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-400 hover:text-teal-300 transition"
          >
            <Plus className="w-4 h-4" /> Add milestone
          </button>
          <LiveTotal label="Milestone total" totalHuman={totalHuman} feeBps={feeBps} />
          <Field label="review window (days)" value={reviewDays} onChange={(e) => setReviewDays(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(0)}>Back</Button>
            <Button onClick={() => setStep(2)}>Next: review</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm font-semibold text-white">{subject}</p>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-white/50">Worker</span><span className="font-mono text-white text-xs">{worker}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Milestone total</span><span className="font-mono text-white">${totalHuman} USDC</span></div>
            <div className="flex justify-between"><span className="text-white/50">Platform fee (on payouts)</span><span className="font-mono text-white/70">${feeOn(totalHuman, feeBps)} USDC est.</span></div>
          </div>
          <div className="flex gap-2 items-center">
            <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
            <IdentityGate agentId={agentId} onOk={() => setDeployOpen(true)} />
          </div>
        </div>
      )}

      {deployOpen && (
        <TxModal
          title="Deploy direct job"
          description={`Approves $${totalHuman} USDC to the market, then creates it.`}
          confirmLabel="Approve & deploy"
          run={async () => {
            await sdk.ensureUsdcAllowance(C.marketRegistry, total(), account!);
            return sdk.createDirectJob({
              worker: worker as `0x${string}`,
              workerAgentId: BigInt(workerAgentId || '0'),
              requesterAgentId: BigInt(agentId || '0'),
              metadataURI: buildMetadata({ subject, description: desc }),
              scopeHash: scope(subject || 'console-job'),
              milestoneAmounts: amounts(),
              reviewWindow: BigInt(Number(reviewDays) * 86400),
            }, account!);
          }}
          onDone={() => { onCreated?.(); setDeployOpen(false); setStep(0); setSubject(''); setDesc(''); setWorker(''); }}
          onClose={() => setDeployOpen(false)}
        />
      )}
    </div>
  );
}

function BountyWizard({ sdk, account, agentId, feeBps, onCreated }: WizardProps) {
  const [step, setStep] = useState(0);
  const [subject, setSubject] = useState('');
  const [desc, setDesc] = useState('');
  const [pool, setPool] = useState('1000');
  const [defaultAward, setDefaultAward] = useState('50');
  const [reviewDays, setReviewDays] = useState('3');
  const [requiredProofs, setProofs] = useState('0');
  const [deployOpen, setDeployOpen] = useState(false);

  return (
    <div className={`${CARD_CLASS} max-w-2xl`}>
      <LockedTypeBadge mode={EchoMode.Bounty} />
      <ProgressSteps steps={['Details', 'Pool & payout', 'Review & deploy']} current={step} />

      {step === 0 && (
        <div className="space-y-3">
          <Field label="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Bounty title" />
          <TextArea label="description" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Scope / terms" rows={4} />
          <Button onClick={() => setStep(1)} disabled={!subject}>Next: pool &amp; payout</Button>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            <Field label="pool USDC" value={pool} onChange={(e) => setPool(e.target.value)} />
            <Field label="payout per finding USDC" value={defaultAward} onChange={(e) => setDefaultAward(e.target.value)} />
          </div>
          <LiveTotal label="Pool" totalHuman={pool} feeBps={feeBps} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1">
            <Field label="review (days)" value={reviewDays} onChange={(e) => setReviewDays(e.target.value)} />
            <Field label="required proofs" value={requiredProofs} onChange={(e) => setProofs(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(0)}>Back</Button>
            <Button onClick={() => setStep(2)}>Next: review</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm font-semibold text-white">{subject}</p>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-white/50">Pool</span><span className="font-mono text-white">${pool} USDC</span></div>
            <div className="flex justify-between"><span className="text-white/50">Payout per accepted finding</span><span className="font-mono text-white">${defaultAward} USDC</span></div>
            <div className="flex justify-between"><span className="text-white/50">Platform fee (on payouts)</span><span className="font-mono text-white/70">${feeOn(pool, feeBps)} USDC est.</span></div>
          </div>
          <div className="flex gap-2 items-center">
            <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
            <IdentityGate agentId={agentId} onOk={() => setDeployOpen(true)} />
          </div>
        </div>
      )}

      {deployOpen && (
        <TxModal
          title="Deploy bounty"
          description={`Approves $${pool} USDC to the market, then creates it.`}
          confirmLabel="Approve & deploy"
          run={async () => {
            await sdk.ensureUsdcAllowance(C.marketRegistry, toUnits(pool), account!);
            return sdk.createBounty({
              requesterAgentId: BigInt(agentId || '0'),
              metadataURI: buildMetadata({ subject, description: desc }),
              scopeHash: scope(subject || 'console-bounty'),
              requiredProofs: BigInt(requiredProofs),
              defaultAward: toUnits(defaultAward),
              reviewWindow: BigInt(Number(reviewDays) * 86400),
              pool: toUnits(pool),
            }, account!);
          }}
          onDone={() => { onCreated?.(); setDeployOpen(false); setStep(0); setSubject(''); setDesc(''); }}
          onClose={() => setDeployOpen(false)}
        />
      )}
    </div>
  );
}

/* ──────────────────────────── my markets ──────────────────────────── */

const MY_MARKETS = gql`
  query MyMarkets($requester: String!) {
    markets(requester: $requester, limit: 100) {
      id mode subject status applicantCount
    }
  }
`;

type MyRow = { id: number; mode: number; subject: string | null; status: string; applicantCount: number };
const STATUS_TONE = { active: 'success', closed: 'neutral', cancelled: 'danger' } as const;

function MyMarkets({ account, createdAt }: { account?: `0x${string}`; createdAt: number }) {
  const { isConnected } = useAccount();
  const [{ data, fetching, error }, refetch] = useQuery<{ markets: MyRow[] }>({
    query: MY_MARKETS,
    variables: { requester: account ?? '' },
    pause: !account,
    requestPolicy: 'cache-and-network',
  });
  const rows = data?.markets ?? [];

  // Refetch when a new market is created — the indexer needs a few seconds to ingest.
  useEffect(() => {
    if (!createdAt) return;
    const delays = [3000, 8000, 15000];
    const timers = delays.map((ms) => setTimeout(() => refetch({ requestPolicy: 'network-only' }), ms));
    return () => { timers.forEach(clearTimeout); };
  }, [createdAt, refetch]);

  return (
    <section>
      <h2 className="text-lg font-bold text-white">My markets</h2>
      <p className="text-sm text-white/50 mt-0.5 mb-3">Markets you created, from the indexer. Click one to manage its lifecycle.</p>
      <div className={CARD_CLASS}>
        {!isConnected && (
          <EmptyState icon={Briefcase} title="Connect a wallet" desc="Connect a wallet to see the markets you've created." />
        )}
        {isConnected && fetching && rows.length === 0 && <p className="text-xs text-white/40">Loading...</p>}
        {error && <p className="text-xs text-danger break-all">{error.message} — is the indexer running on :4000?</p>}
        {isConnected && !fetching && !error && rows.length === 0 && (
          <EmptyState
            icon={Briefcase}
            title="You haven't created any markets yet"
            desc="Pick a market type above to get started."
          />
        )}
        {rows.length > 0 && (
          <ul className="divide-y divide-white/[0.08]">
            {rows.map((m) => (
              <li key={m.id}>
                <Link href={`/hire/${m.id}`} className="flex items-center gap-3 py-2.5 hover:bg-white/[0.03] -mx-1 px-1 rounded">
                  <span className="font-mono text-sm text-white/40 w-10">#{m.id}</span>
                  <Badge tone={modeBadgeTone(m.mode)}>{modeName(m.mode)}</Badge>
                  <span className="flex-1 text-sm font-medium text-white truncate">{m.subject || <span className="text-white/30 italic">untitled</span>}</span>
                  <Badge tone={STATUS_TONE[m.status as keyof typeof STATUS_TONE] ?? 'neutral'}>{m.status}</Badge>
                  <span className="text-xs text-white/40">{m.applicantCount} appl.</span>
                  <span className="text-white/20 text-sm">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
