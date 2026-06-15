'use client';

import Link from 'next/link';
import { useQuery, gql } from 'urql';
import { Section, Card } from '@/components/ui';
import { Command } from '@/components/Command';
import { short, modeName, modeTagClass } from '@/lib/format';

/**
 * Worker home — browse open markets from the indexer. Each card links to the job detail page, where
 * apply + (eligibility-gated) deliver live. No per-market RPC loop.
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
};

export default function ApplyPage() {
  const [{ data, fetching, error }, refetch] = useQuery<{ markets: MarketRow[] }>({ query: OPEN_MARKETS });
  const rows = data?.markets ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Find work</h1>
      <p className="text-sm text-gray-500 mb-6">Open markets on Echo. Open one to see the terms, apply, and deliver.</p>

      <Section title="Open markets" desc="Live from the Echo indexer.">
        <div className="sm:col-span-2">
          <Card title="Browse">
            <Command label="Refresh" tone="neutral" run={async () => { refetch({ requestPolicy: 'network-only' }); return 'refreshed'; }} />
            {fetching && rows.length === 0 && <p className="text-xs text-gray-400">Loading…</p>}
            {error && <p className="text-xs text-red-600 break-all">{error.message} — is the indexer running on :4000?</p>}
            {!fetching && !error && rows.length === 0 && <p className="text-xs text-gray-400">No open markets yet.</p>}
            {rows.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {rows.map((m) => (
                  <li key={m.id}>
                    <Link href={`/apply/${m.id}`} className="flex items-start gap-3 py-3 hover:bg-gray-50 -mx-1 px-1 rounded">
                      <span className="font-mono text-sm text-gray-500 w-10 shrink-0 pt-0.5">#{m.id}</span>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium shrink-0 ${modeTagClass(m.mode)}`}>{modeName(m.mode)}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium truncate">{m.subject || <span className="text-gray-400 italic">untitled market</span>}</span>
                        {m.description && <span className="block text-xs text-gray-500 truncate">{m.description}</span>}
                      </span>
                      <span className="text-xs text-gray-400 shrink-0 pt-0.5">{short(m.requester)} · {m.applicantCount} appl.</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Section>
    </div>
  );
}
