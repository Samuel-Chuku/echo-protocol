'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, XCircle, Wallet, User, Copy, Check, ExternalLink } from 'lucide-react';
import { CONTRACTS } from '@echo/sdk';
import { short, usdc, addrLink, modeName, modeTagClass, isZeroAddr } from '@/lib/format';

const C = CONTRACTS.arcTestnet;

/**
 * A market "receipt" panel for job pages — the parties, the headline amount, and the on-chain
 * identifiers (market id + contract) with copy + Arcscan links. Styled after a payment receipt so the
 * key facts of a job read at a glance, regardless of mode.
 */
export function Receipt({
  marketId,
  mode,
  status,
  requester,
  worker,
  amount,
  amountLabel,
}: {
  marketId: number | string;
  mode: number;
  status?: string;
  requester?: string | null;
  worker?: string | null;
  amount?: string | null;
  amountLabel?: string;
}) {
  const active = status === 'active' || status === undefined;
  const cancelled = status === 'cancelled';
  const StatusIcon = cancelled ? XCircle : active ? Clock : CheckCircle2;
  const statusColor = cancelled ? 'text-red-500' : active ? 'text-amber-500' : 'text-emerald-500';

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">Receipt</h3>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${modeTagClass(mode)}`}>{modeName(mode)}</span>
      </div>

      <div className="mt-3 space-y-2">
        <Row icon={<StatusIcon className={`h-4 w-4 ${statusColor}`} />} label="Status">
          <span className="capitalize text-gray-700">{status ?? 'active'}</span>
        </Row>

        <Row icon={<Wallet className="h-4 w-4 text-gray-400" />} label="Creator">
          {requester ? <Party addr={requester} /> : <span className="text-gray-400">—</span>}
        </Row>

        {worker !== undefined && (
          <Row icon={<User className="h-4 w-4 text-gray-400" />} label="Participant">
            {worker && !isZeroAddr(worker) ? <Party addr={worker} /> : <span className="text-gray-400">unassigned</span>}
          </Row>
        )}

        {amount && amount !== '0' && (
          <Row icon={<CheckCircle2 className="h-4 w-4 text-gray-300" />} label={amountLabel ?? 'Escrow'}>
            <span className="font-mono text-gray-700">{usdc(BigInt(amount))} USDC</span>
          </Row>
        )}
      </div>

      {/* On-chain identifiers — market id + the registry contract, like a transfer-id block. */}
      <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Market ID</span>
          <span className="font-mono text-gray-700">#{marketId}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Contract</span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-xs text-gray-600">{short(C.marketRegistry)}</span>
            <CopyBtn value={C.marketRegistry} title="Copy contract address" />
            <a href={addrLink(C.marketRegistry)} target="_blank" rel="noreferrer" title="View on Arcscan" className="text-gray-400 hover:text-gray-700">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {icon}
      <span className="text-gray-500">{label}</span>
      <span className="flex-1" />
      <span className="text-right">{children}</span>
    </div>
  );
}

/** An address with profile link, copy, and Arcscan. */
function Party({ addr }: { addr: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Link href={`/u/${addr}`} className="font-mono text-xs text-gray-700 hover:underline">{short(addr)}</Link>
      <CopyBtn value={addr} title="Copy address" />
      <a href={addrLink(addr)} target="_blank" rel="noreferrer" title="View on Arcscan" className="text-gray-400 hover:text-gray-700">
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </span>
  );
}

function CopyBtn({ value, title }: { value: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {}); }}
      title={title}
      className="text-gray-400 hover:text-gray-700"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
