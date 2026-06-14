'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { CONTRACTS, MarketRegistryABI, DisputeResolverABI } from '@echo/sdk';
import { useEcho } from '@/lib/sdk';
import { Card } from '@/components/ui';
import { Command } from '@/components/Command';
import { short, txLink } from '@/lib/format';

const C = CONTRACTS.arcTestnet;

type Row = { block: bigint; name: string; summary: string; tx: string };

/** Pull a compact human summary out of an event's decoded args (bigints → strings). */
function summarize(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of ['marketId', 'disputeId', 'index', 'tier', 'toTier', 'award', 'amount', 'revealFee', 'bond']) {
    if (args[k] !== undefined) parts.push(`${k}=${String(args[k])}`);
  }
  for (const k of ['participant', 'submitter', 'requester', 'opener', 'worker', 'originator']) {
    if (typeof args[k] === 'string') parts.push(`${k}=${short(args[k] as string)}`);
  }
  return parts.slice(0, 3).join(' · ') || '';
}

export default function Landing() {
  const { sdk } = useEcho();
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState('');

  async function load() {
    setErr('');
    try {
      const latest = await sdk.publicClient.getBlockNumber();
      const fromBlock = latest > 50_000n ? latest - 50_000n : 0n;
      const [mr, dr] = await Promise.all([
        sdk.publicClient.getContractEvents({ address: C.marketRegistry, abi: MarketRegistryABI, fromBlock, toBlock: latest }),
        sdk.publicClient.getContractEvents({ address: C.disputeResolver, abi: DisputeResolverABI, fromBlock, toBlock: latest }),
      ]);
      const all: Row[] = [...mr, ...dr].map((l: any) => ({
        block: l.blockNumber as bigint,
        name: l.eventName as string,
        summary: summarize((l.args ?? {}) as Record<string, unknown>),
        tx: l.transactionHash as string,
      }));
      all.sort((a, b) => Number(b.block - a.block));
      setRows(all.slice(0, 30));
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || String(e));
    }
  }

  return (
    <div>
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Echo Protocol — reference console</h1>
        <p className="text-gray-500 mt-1 max-w-2xl">
          A functional, click-through guide to every on-chain command. Each role tab wires real SDK
          calls to buttons. Reads come straight from the chain (no indexer yet).
        </p>
        <div className="flex gap-2 mt-4 text-sm">
          {[['/hire', 'Requester'], ['/apply', 'Worker'], ['/attribution', 'Introducer'], ['/disputes', 'Disputes']].map(([href, label]) => (
            <Link key={href} href={href} className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200">{label} →</Link>
          ))}
        </div>
      </section>

      <Card title="Live activity" hint="Recent MarketRegistry + DisputeResolver events over the last ~50k blocks (what the real ticker will index).">
        <Command label="Load activity" tone="neutral" run={load} />
        {err && <p className="text-xs text-red-600 break-all">{err}</p>}
        <ul className="text-sm divide-y divide-gray-100">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-1.5">
              <span><b className="font-medium">{r.name}</b> <span className="text-gray-500 font-mono text-xs">{r.summary}</span></span>
              <a href={txLink(r.tx)} target="_blank" rel="noreferrer" className="text-xs text-gray-400 hover:text-gray-700 inline-flex items-center gap-1 shrink-0">
                #{String(r.block)} <ExternalLink className="w-3 h-3" />
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
