'use client';

import {
  type ReactNode,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
  type ButtonHTMLAttributes,
} from 'react';
import Link from 'next/link';
import { Loader2, Github, Twitter } from 'lucide-react';

/** Shared card surface classes — dark surface, subtle border, teal top-line on hover (no heavy shadows). */
export const CARD_CLASS =
  'relative rounded-card border border-white/[0.08] bg-white/[0.03] p-4 transition-colors ' +
  'hover:border-teal-500/20 before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:rounded-t-card ' +
  'before:origin-left before:scale-x-0 before:bg-teal-500 before:transition-transform before:duration-200 hover:before:scale-x-100';

export const INPUT_CLASS =
  'mt-1 w-full px-3 py-2 text-sm rounded-lg bg-white/[0.05] border border-white/10 text-white ' +
  'placeholder:text-white/30 focus:outline-none focus:border-teal-500/40 transition-colors';

/** A titled panel grouping one role's command cards. */
export function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      {desc && <p className="text-sm text-white/50 mt-0.5 mb-3">{desc}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** One panel: a heading, optional blurb, the form fields, and the action button(s). */
export function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className={CARD_CLASS}>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {hint && <p className="text-xs text-white/40 mt-0.5">{hint}</p>}
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

export function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-white/50">{label}</span>
      <input {...props} className={INPUT_CLASS} />
    </label>
  );
}

export function TextArea({ label, ...props }: { label: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-white/50">{label}</span>
      <textarea {...props} className={`${INPUT_CLASS} resize-none`} />
    </label>
  );
}

export function Select({ label, children, ...props }: { label: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-white/50">{label}</span>
      <select {...props} className={INPUT_CLASS}>{children}</select>
    </label>
  );
}

/** A read-only key/value panel for on-chain state. */
export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="text-sm divide-y divide-white/[0.08] rounded-lg border border-white/[0.08] overflow-hidden">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 px-3 py-1.5">
          <dt className="text-white/50">{k}</dt>
          <dd className="font-mono text-white text-right break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

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

type ButtonVariant = 'primary' | 'secondary' | 'danger';
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-teal-500 text-ink font-semibold hover:bg-teal-400',
  secondary: 'bg-transparent border border-white/20 text-white hover:border-white/40',
  danger: 'bg-danger/10 border border-danger/30 text-danger hover:bg-danger/20',
};

type ButtonProps = {
  variant?: ButtonVariant;
  href?: string;
  busy?: boolean;
  children: ReactNode;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>;

/** Primary/secondary/danger button, optionally rendered as a Link when `href` is given. */
export function Button({ variant = 'primary', href, busy, children, className = '', disabled, ...props }: ButtonProps) {
  const cls = `inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 min-h-[44px] text-sm transition disabled:opacity-40 disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${className}`;
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button className={cls} disabled={disabled || busy} {...props}>
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

/** Never show "Nothing here." — an icon, a descriptive title, a one-line explanation, and a CTA. */
export function EmptyState({
  icon: Icon,
  title,
  desc,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-500/10 text-teal-400">
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-white">{title}</h3>
      <p className="mt-1 text-sm text-white/50 max-w-sm">{desc}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
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

export function Tabs<T extends string>({
  options,
  value,
  onChange,
  counts,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  counts?: Record<string, number>;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto -mx-1 px-1 sm:flex-wrap sm:overflow-visible sm:mx-0 sm:px-0">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 min-h-[44px] text-sm rounded-full transition font-medium shrink-0 ${
              active ? 'bg-teal-500 text-ink' : 'text-white/50 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            {o.label}
            {counts?.[o.value] !== undefined && (
              <span className={active ? 'text-ink/60 ml-1.5' : 'text-white/30 ml-1.5'}>{counts[o.value]}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Step progress indicator for multi-step forms (e.g. Create Market wizard). */
export function ProgressSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 mb-6">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center gap-2 flex-1">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition ${
                done ? 'bg-teal-500 text-ink' : active ? 'border-2 border-teal-500 text-teal-400' : 'border border-white/15 text-white/40'
              }`}
            >
              {i + 1}
            </span>
            <span className={`hidden sm:inline text-sm font-medium ${active ? 'text-white' : 'text-white/40'}`}>{label}</span>
            {i < steps.length - 1 && <span className="h-px flex-1 bg-white/10" />}
          </li>
        );
      })}
    </ol>
  );
}

export type TierStep = { label: string; amount: string; note?: string };

/** Reusable horizontal payout-tier step indicator — teal dots, connecting lines, name/payout/notes below. */
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
            {/* App callers pass bare USDC numbers (prefix "$"); the marketing surface passes words
                like "stake"/"+USDC"/"split" (render as-is). */}
            <span className="mt-0.5 text-sm font-mono text-teal-400">{/^-?\d/.test(s.amount) ? `$${s.amount}` : s.amount}</span>
            {s.note && <span className="mt-0.5 text-[11px] text-white/40 max-w-[8rem]">{s.note}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Asset-free Echo wordmark glyph: a source dot emitting concentric arcs ("echo"). Used on the
 *  marketing surface header/footer; no external image dependency. */
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

/** Arc network mark (Circle's Arc). Fills with currentColor so callers tint it via text-* classes. */
export function ArcMark({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 164 171" className={className} fill="currentColor" role="img" aria-label="Arc">
      <path d="M0 171C1.39327 129.136 8.52567 90.067 20.4481 59.6871C35.5477 21.1972 57.4057 0 81.9919 0C106.578 0 128.433 21.1972 143.536 59.6871C151.391 79.7058 157.17 103.491 160.594 129.366C160.9 131.677 161.161 134.026 161.428 136.369C161.515 136.514 161.568 136.649 161.55 136.758C161.55 136.758 163.562 149.265 163.99 171H163.763C160.778 168.562 125.578 141.038 67.2282 149.007C68.1086 139.181 69.3194 129.62 70.8835 120.456C70.9634 119.987 71.0558 119.535 71.1373 119.07C94.0233 118.383 114.055 121.028 129.416 124.494C129.359 124.131 129.311 123.758 129.253 123.397C126.095 103.83 121.437 85.9161 115.43 70.6073C105.61 45.576 92.7953 30.0239 81.9919 30.0239C71.189 30.0239 58.3744 45.576 48.554 70.6073C46.1769 76.6621 44.0128 83.1192 42.0721 89.9301C39.3438 99.4735 37.0517 109.704 35.2212 120.455C32.5117 136.331 30.8189 153.358 30.1954 171H0Z" />
    </svg>
  );
}

/** USDC token mark (Circle's official coin). Colors baked in (blue disc + white glyph); inlined so it
 *  needs no next/image SVG allowance. */
export function UsdcMark({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" className={`inline-block shrink-0 ${className}`} role="img" aria-label="USDC" fill="none">
      <path d="M48 95C73.9574 95 95 73.9574 95 48C95 22.0426 73.9574 1 48 1C22.0426 1 1 22.0426 1 48C1 73.9574 22.0426 95 48 95Z" fill="#0B53BF" />
      <path d="M56.4609 13.7778V19.8291C68.5341 23.4716 77.3759 34.6928 77.3759 47.9997C77.3759 61.3066 68.5341 72.5278 56.4609 76.1703V82.2216C71.8534 78.4616 83.2509 64.5672 83.2509 47.9997C83.2509 31.4322 71.8534 17.5378 56.4609 13.7778Z" fill="white" />
      <path d="M18.625 47.9997C18.625 34.6928 27.4669 23.4716 39.54 19.8291V13.7778C24.1475 17.5378 12.75 31.4322 12.75 47.9997C12.75 64.5672 24.1475 78.4616 39.54 82.2216V76.1703C27.4669 72.5572 18.625 61.3066 18.625 47.9997Z" fill="white" />
      <path d="M60.6319 54.5506C60.6319 42.5362 41.8025 47.4713 41.8025 40.8325C41.8025 38.4531 43.7119 36.9256 47.3544 36.9256C51.7019 36.9256 53.2 39.0406 53.67 41.89H59.6625C59.1279 36.5426 56.0588 33.1662 50.9382 32.1604V27.4375H45.0632V31.9918C39.4534 32.7062 35.9275 35.973 35.9275 40.8325C35.9275 52.9056 54.7863 48.3819 54.7863 54.9031C54.7863 57.3706 52.4069 59.0156 48.3825 59.0156C43.1244 59.0156 41.3913 56.695 40.745 53.4931H34.8994C35.2781 59.3502 38.8897 63.0159 45.0632 63.9307V68.5625H50.9382V63.9923C56.9633 63.2139 60.6319 59.7089 60.6319 54.5506Z" fill="white" />
    </svg>
  );
}

// Canonical off-site links, shared by both footers.
export const ECHO_TWITTER = 'https://x.com/echoprotocol_tm';
export const ECHO_GITHUB = 'https://github.com/Samuel-Chuku/echo-protocol';

/** Pronounced social row (Twitter/X + GitHub). Real links, filled-teal hover. */
export function Socials({ className = '' }: { className?: string }) {
  const items = [
    { Icon: Twitter, label: 'Twitter / X', href: ECHO_TWITTER },
    { Icon: Github, label: 'GitHub', href: ECHO_GITHUB },
  ];
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {items.map(({ Icon, label, href }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noreferrer"
          title={label}
          aria-label={label}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-white/70 hover:text-ink hover:bg-teal-500 hover:border-teal-500 transition"
        >
          <Icon className="w-5 h-5" />
        </a>
      ))}
    </div>
  );
}
