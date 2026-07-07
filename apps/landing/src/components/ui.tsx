import type { ReactNode } from 'react';

// Card treatment ported verbatim from apps/web so the landing reads as one family with the app:
// hairline border, faint fill, and a teal top-edge that wipes in on hover.
export const CARD_CLASS =
  'relative rounded-card border border-white/[0.08] bg-white/[0.03] p-4 transition-colors ' +
  'hover:border-teal-500/20 before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:rounded-t-card ' +
  'before:origin-left before:scale-x-0 before:bg-teal-500 before:transition-transform before:duration-200 hover:before:scale-x-100';

type BadgeTone = 'teal' | 'success' | 'warning' | 'danger' | 'neutral';
const BADGE_TONES: Record<BadgeTone, string> = {
  teal: 'bg-teal-500/15 text-teal-400 border-teal-500/20',
  success: 'bg-success/15 text-success border-success/20',
  warning: 'bg-warning/15 text-warning border-warning/20',
  danger: 'bg-danger/15 text-danger border-danger/20',
  neutral: 'bg-white/[0.06] text-white/60 border-white/10',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium border ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

export function StatCard({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className={CARD_CLASS}>
      <p className="text-xs font-medium uppercase tracking-wide text-white/40">{label}</p>
      <p className="mt-1.5 text-2xl font-bold text-white tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-white/40">{sub}</p>}
    </div>
  );
}

export type TierStep = { label: string; amount: string; note?: string };

/** Horizontal payout-tier step indicator — teal dots, connecting lines, name/payout/notes below. */
export function TierTrack({ steps, currentIndex }: { steps: TierStep[]; currentIndex?: number }) {
  return (
    <ol className="flex items-stretch gap-0">
      {steps.map((s, i) => {
        const reached = currentIndex !== undefined && i <= currentIndex;
        return (
          <li key={s.label} className="flex-1 flex flex-col items-center text-center relative px-1">
            {i > 0 && (
              <span
                className={`absolute top-2 right-1/2 left-[-50%] h-px ${reached ? 'bg-teal-500' : 'bg-white/10'}`}
                aria-hidden
              />
            )}
            <span
              className={`relative z-10 h-4 w-4 rounded-full border-2 ${
                reached ? 'bg-teal-500 border-teal-500' : 'bg-ink border-white/20'
              }`}
            />
            <span className="mt-2 text-xs font-semibold text-white">{s.label}</span>
            <span className="mt-0.5 text-sm font-mono text-teal-400">{s.amount}</span>
            {s.note && <span className="mt-0.5 text-[11px] text-white/40 max-w-[8rem]">{s.note}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Asset-free brand mark: a source dot emitting concentric "echo" arcs, in the teal/ink palette. */
export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="Echo Protocol">
      <circle cx="16" cy="16" r="15" fill="#00E5C0" />
      <circle cx="11" cy="16" r="2.2" fill="#0A2540" />
      <path d="M15 11 a6 6 0 0 1 0 10" fill="none" stroke="#0A2540" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M18.5 8.5 a10 10 0 0 1 0 15"
        fill="none"
        stroke="#0A2540"
        strokeWidth="2"
        strokeLinecap="round"
        strokeOpacity="0.55"
      />
    </svg>
  );
}
