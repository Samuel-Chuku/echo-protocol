'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useQuery, gql } from 'urql';
import { Section } from '@/components/ui';
import { Command } from '@/components/Command';
import { usdc, short, modeName, modeTagClass, ago, duration } from '@/lib/format';

/**
 * Worker home — browse open markets from the indexer. Each card previews its payout tiers inline
 * (expandable, no navigation needed) and links into the full job page.
 */
const OPEN_MARKETS = gql`
  query OpenMarkets {
    markets(openOnly: true, limit: 100) {
      id
      mode
      requester
      subject
      description
      applicantCount
      tiers
      createdAt
      ghostDeadline
    }
  }
`;

type MarketRow = {
  id: number;
  mode: number;
  requester: string;
  subject: string | null;
  description: string | null;
  applicantCount: number;
  tiers: string[] | null;
  createdAt: number;
  ghostDeadline: number | null;
};

export default function ApplyPage() {
  const [{ data, fetching, error }, refetch] = useQuery<{ markets: MarketRow[] }>({ query: OPEN_MARKETS });
  const rows = data?.markets ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Find work</h1>
      <p className="text-sm text-gray-500 mb-6">Open markets on Echo. Preview the payout tiers, then open one to apply.</p>

      <Section title="Open markets" desc="Live from the Echo indexer.">
        <div className="sm:col-span-2 space-y-3">
          <Command label="Refresh" tone="neutral" run={async () => { refetch({ requestPolicy: 'network-only' }); return 'refreshed'; }} />
          {fetching && rows.length === 0 && <p className="text-xs text-gray-400">Loading…</p>}
          {error && <p className="text-xs text-red-600 break-all">{error.message} — is the indexer running on :4000?</p>}
          {!fetching && !error && rows.length === 0 && <p className="text-xs text-gray-400">No open markets yet.</p>}
          {rows.map((m) => <MarketCard key={m.id} m={m} />)}
        </div>
      </Section>
    </div>
  );
}

const TIER_LABELS = ['Reveal', 'Shortlist', 'Final', 'Ghost'];

function MarketCard({ m }: { m: MarketRow }) {
  const [open, setOpen] = useState(false);
  // Only Open/Reveal markets carry tier amounts; ignore empty/all-zero tier arrays.
  const tiers = (m.tiers ?? []).filter((t) => t && t !== '0');
  const hasTiers = tiers.length > 0;

  return (
    <div className="p-4 rounded-xl border border-gray-200 bg-white">
      <div className="flex items-start gap-3">
        <span className="font-mono text-sm text-gray-500 w-10 shrink-0 pt-0.5">#{m.id}</span>
        <span className={`rounded px-2 py-0.5 text-xs font-medium shrink-0 ${modeTagClass(m.mode)}`}>{modeName(m.mode)}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold truncate">{m.subject || <span className="text-gray-400 italic">untitled market</span>}</span>
          {m.description && <span className="block text-xs text-gray-500 line-clamp-2">{m.description}</span>}
        </span>
        <span className="text-xs text-gray-400 shrink-0 pt-0.5">{short(m.requester)} · {m.applicantCount} appl.</span>
      </div>

      <div className="mt-2 flex items-center gap-3 text-xs text-gray-400 pl-[52px]">
        <span>Created {ago(m.createdAt)}</span>
        {m.ghostDeadline ? <span>· Runs {duration(m.ghostDeadline)}</span> : null}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        {hasTiers ? (
          <button
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Tier Structure
          </button>
        ) : <span className="text-xs text-gray-400">No tier structure</span>}

        <Link
          href={`/apply/${m.id}`}
          className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
        >
          View job →
        </Link>
      </div>

      {open && hasTiers && (
        <ol className="mt-3 space-y-2 border-t border-gray-100 pt-3">
          {tiers.map((t, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">{i + 1}</span>
              <span className="flex-1 text-sm font-medium">{TIER_LABELS[i] ?? `Tier ${i + 1}`}</span>
              <span className="text-sm font-mono text-gray-700">{usdc(BigInt(t))} USDC</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
