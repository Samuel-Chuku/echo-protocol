'use client';

import { useEffect, useState } from 'react';
import { Bot, ExternalLink } from 'lucide-react';
import { getAgentDecisions, type AgentDecision } from '@/lib/agentApi';
import { txLink, short } from '@/lib/format';
import { CARD_CLASS } from '@/components/ui';

const STAGE_LABEL: Record<string, { text: string; cls: string }> = {
  revealed: { text: 'Revealed', cls: 'text-teal-300' },
  advanced: { text: 'Advanced → Shortlist', cls: 'text-success' },
  ranked: { text: 'Ranked (needs your review)', cls: 'text-warning' },
  screened: { text: 'Skipped (below bar)', cls: 'text-white/40' },
};

/**
 * The autonomous agent's activity feed for a market (#4). Polls the indexer's /agent/decisions and
 * shows what the agent did per applicant + why. Only renders when the market is agent-run (decisions
 * exist). Ranked applicants are the ones the agent deferred to the human — sorted to the top.
 */
export function AgentDecisions({ marketId }: { marketId: number }) {
  const [rows, setRows] = useState<AgentDecision[]>([]);

  useEffect(() => {
    let active = true;
    const load = () => getAgentDecisions(marketId).then((d) => { if (active) setRows(d); }).catch(() => {});
    load();
    const iv = setInterval(load, 8000); // live-ish feed while the agent works
    return () => { active = false; clearInterval(iv); };
  }, [marketId]);

  if (rows.length === 0) return null;

  // Ranked first (they need action), then advanced, revealed, screened; ranked ordered by rank.
  const order: Record<string, number> = { ranked: 0, advanced: 1, revealed: 2, screened: 3 };
  const sorted = [...rows].sort((a, b) =>
    (order[a.stage] ?? 9) - (order[b.stage] ?? 9) || (a.rank ?? 99) - (b.rank ?? 99),
  );

  return (
    <div className={CARD_CLASS}>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white">
        <Bot className="w-4 h-4 text-teal-400" /> AI agent activity
      </h3>
      <p className="text-xs text-white/40 mt-0.5">
        The agent screened previews, revealed promising applicants, and auto-advanced those clearly meeting your
        guardrails. <b className="text-white/60">Ranked</b> applicants met the reveal bar but not the advance bar — your call.
      </p>
      <ul className="mt-3 divide-y divide-white/[0.08]">
        {sorted.map((d) => {
          const s = STAGE_LABEL[d.stage] ?? { text: d.stage, cls: 'text-white/50' };
          return (
            <li key={d.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {d.stage === 'ranked' && d.rank != null && <span className="font-mono text-warning">#{d.rank}</span>}
              <span className="font-mono text-white/80">{short(d.participant)}</span>
              <span className={`text-xs font-medium ${s.cls}`}>{s.text}</span>
              {d.revealScore != null && <span className="text-[11px] text-white/30">score {d.revealScore}</span>}
              {d.txHash && (
                <a href={txLink(d.txHash)} target="_blank" rel="noreferrer" className="text-[11px] text-teal-400 inline-flex items-center gap-0.5 hover:underline">
                  tx <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {(d.reason || d.revealReason) && (
                <span className="w-full text-xs text-white/50">{d.reason || d.revealReason}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
