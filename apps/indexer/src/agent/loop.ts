import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { agentMarkets, agentDecisions, applications, contents, attachments } from '../db/schema.js';
import { config } from '../config.js';
import { screenPreview, evaluateGuardrails } from './brain.js';
import { execReveal, execGradeShortlist, waitForTx } from './circle.js';

/**
 * Autonomous agent loop (#4). Per enabled agent-market, for each applicant not yet decided:
 *   screen the public preview → if it clears the requester's reveal threshold (and under the reveal
 *   cap), autonomously REVEAL from the requester's Circle DCW. Then, for revealed applicants, check
 *   the requester's advancement guardrails → if CLEARLY met (and under the advance cap), auto-advance
 *   to Shortlist; otherwise rank the applicant with a reason and defer to the human.
 *
 * The agent_decisions table is the idempotency ledger: a row's stage tells us what's already done.
 * Every on-chain action goes through Circle (no key here). Failures are per-applicant isolated.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

type Decision = typeof agentDecisions.$inferSelect;

async function getDecision(marketId: number, participant: string): Promise<Decision | undefined> {
  const [row] = await db.select().from(agentDecisions)
    .where(eq(agentDecisions.id, `${marketId}-${participant}`)).limit(1);
  return row;
}

async function countStages(marketId: number, stages: string[]): Promise<number> {
  const [row] = await db.select({ c: sql<number>`count(*)` }).from(agentDecisions)
    .where(and(eq(agentDecisions.marketId, marketId), inArray(agentDecisions.stage, stages)));
  return Number(row?.c ?? 0);
}

async function upsertDecision(d: Partial<Decision> & { marketId: number; participant: string; stage: string }): Promise<void> {
  const id = `${d.marketId}-${d.participant}`;
  const row = { ...d, id, updatedAt: nowSec(), createdAt: nowSec() };
  await db.insert(agentDecisions).values(row as any).onConflictDoUpdate({
    target: agentDecisions.id,
    set: { stage: d.stage, revealScore: d.revealScore, revealReason: d.revealReason, advanceMet: d.advanceMet, rank: d.rank, reason: d.reason, txHash: d.txHash, updatedAt: nowSec() },
  });
}

async function readContentBody(marketId: number, kind: string, key: string): Promise<string> {
  const [row] = await db.select().from(contents)
    .where(eq(contents.id, `${marketId}-${kind}-${key.toLowerCase()}`)).limit(1);
  return row?.body ?? '';
}

async function readAttachmentMeta(marketId: number, kind: string, key: string): Promise<{ filename: string; mime: string }[]> {
  return db.select({ filename: attachments.filename, mime: attachments.mime }).from(attachments)
    .where(and(eq(attachments.marketId, marketId), eq(attachments.kind, kind), eq(attachments.key, key.toLowerCase())));
}

/** Re-rank the market's ranked (revealed, not advanced) applicants by reveal score, best = rank 1. */
async function recomputeRanks(marketId: number): Promise<void> {
  const ranked = await db.select().from(agentDecisions)
    .where(and(eq(agentDecisions.marketId, marketId), eq(agentDecisions.stage, 'ranked')));
  ranked.sort((a, b) => (b.revealScore ?? 0) - (a.revealScore ?? 0));
  let rank = 1;
  for (const r of ranked) {
    await db.update(agentDecisions).set({ rank: rank++, updatedAt: nowSec() }).where(eq(agentDecisions.id, r.id));
  }
}

async function processMarket(m: typeof agentMarkets.$inferSelect): Promise<void> {
  const apps = await db.select().from(applications).where(eq(applications.marketId, m.marketId));
  let revealsUsed = await countStages(m.marketId, ['revealed', 'advanced']);
  let advancesUsed = await countStages(m.marketId, ['advanced']);
  let touched = false;

  for (const app of apps) {
    const participant = app.participant.toLowerCase();
    const prior = await getDecision(m.marketId, participant);

    // ── Screen + reveal (no prior decision) ──
    if (!prior) {
      const preview = await readContentBody(m.marketId, 'preview', participant);
      const { score, reason } = await screenPreview(preview, m.revealCriteria);
      if (score >= m.revealThreshold && revealsUsed < m.maxReveals) {
        // Dry-run records the decision but performs no on-chain reveal (no Circle call, no tx).
        const txHash = config.agentDryRun ? null : await waitForTx(await execReveal(m.walletId, m.marketId, participant));
        revealsUsed++;
        await upsertDecision({ marketId: m.marketId, participant, stage: 'revealed', revealScore: score, revealReason: reason, txHash: txHash ?? undefined });
      } else {
        await upsertDecision({ marketId: m.marketId, participant, stage: 'screened', revealScore: score, revealReason: reason });
      }
      touched = true;
      continue; // guardrail step runs on the next pass, once the reveal has settled/indexed
    }

    // ── Guardrail + advance (already revealed, not yet advanced/ranked) ──
    if (prior.stage === 'revealed') {
      const submission = await readContentBody(m.marketId, 'apply', participant);
      const files = await readAttachmentMeta(m.marketId, 'apply', participant);
      const verdict = await evaluateGuardrails(submission, files, m.advanceGuardrails);
      const clearlyMet = verdict.met && verdict.confidence >= 70;
      if (clearlyMet && advancesUsed < m.maxAdvances) {
        const txHash = config.agentDryRun ? null : await waitForTx(await execGradeShortlist(m.walletId, m.marketId, participant));
        advancesUsed++;
        await upsertDecision({ marketId: m.marketId, participant, stage: 'advanced', revealScore: prior.revealScore, advanceMet: 1, reason: verdict.reason, txHash: txHash ?? undefined });
      } else {
        // Not clearly met (or cap hit) → defer to a human with a ranked recommendation.
        await upsertDecision({ marketId: m.marketId, participant, stage: 'ranked', revealScore: prior.revealScore, advanceMet: verdict.met ? 1 : 0, reason: verdict.reason });
      }
      touched = true;
    }
  }

  if (touched) await recomputeRanks(m.marketId);
}

export async function runAgentLoop(): Promise<void> {
  if (!config.agentEnabled) return;
  if (!config.openrouterApiKey) {
    console.warn('[agent] enabled but OPENROUTER_API_KEY missing — loop idle');
    return;
  }
  if (!config.agentDryRun && !config.circleApiKey) {
    console.warn('[agent] enabled but CIRCLE_API_KEY missing (and not dry-run) — loop idle');
    return;
  }
  console.log(`[agent] autonomous screening loop started${config.agentDryRun ? ' (DRY RUN — no on-chain actions)' : ''}`);
  for (;;) {
    try {
      const markets = await db.select().from(agentMarkets).where(eq(agentMarkets.enabled, 1));
      for (const m of markets) {
        try {
          await processMarket(m);
        } catch (e) {
          console.error(`[agent] market ${m.marketId} error:`, (e as Error).message);
        }
      }
    } catch (e) {
      console.error('[agent] loop error:', (e as Error).message);
    }
    await sleep(config.agentPollIntervalMs);
  }
}
