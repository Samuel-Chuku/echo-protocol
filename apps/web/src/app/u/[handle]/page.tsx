'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { getAddress } from 'viem';
import { useAccount } from 'wagmi';
import { useQuery, gql } from 'urql';
import { eventLabel, summarizeArgs, timeAgo, marketHref, type ActivityRow } from '@/lib/activity';
import { short, modeName, modeTagClass, txLink, addrLink, usdc, toUnits } from '@/lib/format';
import { Section, Card, KV, Field } from '@/components/ui';
import { Command } from '@/components/Command';
import { useEcho } from '@/lib/sdk';
import { CIRCLE_CONNECTOR_ID } from '@/lib/circle';

/**
 * Public profile (#7, profiles-only — reputation scoring stays deferred). Aggregates what the indexer
 * already knows about an address: markets they created (requester), applications they made (worker),
 * and recent activity. No P/R/G-Rep math.
 */
const PROFILE = gql`
  query Profile($address: String!) {
    asRequester: markets(requester: $address, limit: 100) {
      id mode subject status applicantCount requesterAgentId
    }
    asWorker: applications(participant: $address) {
      id marketId agentId tierReached status createdAt
    }
    activity(address: $address, limit: 50) {
      id blockNumber txHash eventName marketId actor args state createdAt
    }
  }
`;

type Mkt = { id: number; mode: number; subject: string | null; status: string; applicantCount: number; requesterAgentId: string | null };
type App = { id: string; marketId: number; agentId: string | null; tierReached: number; status: string; createdAt: number };
type ProfileData = { asRequester: Mkt[]; asWorker: App[]; activity: ActivityRow[] };

export default function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  // Markets/applications are stored checksummed; normalise so the URL matches regardless of casing.
  const address = useMemo(() => { try { return getAddress(handle); } catch { return null; } }, [handle]);

  const [{ data, fetching, error }] = useQuery<ProfileData>({
    query: PROFILE,
    variables: { address: address ?? '' },
    pause: !address,
  });

  if (!address) {
    return <p className="text-sm text-red-600">Not a valid address: {handle}</p>;
  }

  const markets = data?.asRequester ?? [];
  const apps = data?.asWorker ?? [];
  const activity = data?.activity ?? [];
  const agentId = apps.find((a) => a.agentId && a.agentId !== '0')?.agentId
    ?? markets.find((m) => m.requesterAgentId && m.requesterAgentId !== '0')?.requesterAgentId
    ?? null;
  const now = Math.floor(Date.now() / 1000);

  // Send is offered only to the profile's own passkey (Circle) wallet, viewing its own profile.
  const { address: connected, connector } = useAccount();
  const isOwn = !!connected && connected.toLowerCase() === address.toLowerCase();
  const isPasskey = connector?.id === CIRCLE_CONNECTOR_ID;
  const showSend = isOwn && isPasskey;

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-2xl font-bold font-mono">{short(address)}</h1>
        <a href={addrLink(address)} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-gray-700"><ExternalLink className="w-4 h-4" /></a>
      </div>
      <p className="text-sm text-gray-500 mb-6 font-mono break-all">{address}</p>

      {showSend && (
        <Section title="Send USDC" desc="Transfer USDC from your passkey wallet. Gas is sponsored on Arc.">
          <div className="sm:col-span-2"><SendUsdc /></div>
        </Section>
      )}

      <Section title="Overview" desc="Public on-chain activity on Echo.">
        <Card title="Summary">
          <KV rows={[
            ['agentId', agentId ?? '—'],
            ['markets created', String(markets.length)],
            ['applications', String(apps.length)],
          ]} />
        </Card>
      </Section>

      {fetching && !data && <p className="text-sm text-gray-400">Loading…</p>}
      {error && <p className="text-sm text-red-600 break-all">{error.message} — is the indexer running on :4000?</p>}

      <Section title="As requester" desc="Markets this address created.">
        <div className="sm:col-span-2">
          <Card title="Markets created">
            {markets.length === 0 ? <p className="text-xs text-gray-400">None.</p> : (
              <ul className="divide-y divide-gray-100">
                {markets.map((m) => (
                  <li key={m.id}>
                    <Link href={`/apply/${m.id}`} className="flex items-center gap-3 py-2 hover:bg-gray-50 -mx-1 px-1 rounded">
                      <span className="font-mono text-sm text-gray-500 w-10">#{m.id}</span>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${modeTagClass(m.mode)}`}>{modeName(m.mode)}</span>
                      <span className="flex-1 text-sm font-medium truncate">{m.subject || <span className="text-gray-400 italic">untitled</span>}</span>
                      <span className="text-xs text-gray-400">{m.status} · {m.applicantCount} appl.</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Section>

      <Section title="As worker" desc="Applications this address submitted.">
        <div className="sm:col-span-2">
          <Card title="Applications">
            {apps.length === 0 ? <p className="text-xs text-gray-400">None.</p> : (
              <ul className="divide-y divide-gray-100">
                {apps.map((a) => (
                  <li key={a.id}>
                    <Link href={`/apply/${a.marketId}`} className="flex items-center gap-3 py-2 hover:bg-gray-50 -mx-1 px-1 rounded">
                      <span className="font-mono text-sm text-gray-500 w-10">#{a.marketId}</span>
                      <span className="flex-1 text-sm">{a.status}</span>
                      <span className="text-xs text-gray-400">tier {a.tierReached}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Section>

      <Section title="Recent activity" desc="Latest events involving this address.">
        <div className="sm:col-span-2">
          <Card title="Activity">
            {activity.length === 0 ? <p className="text-xs text-gray-400">None.</p> : (
              <ul className="divide-y divide-gray-100">
                {activity.map((r) => {
                  const href = marketHref(r, address);
                  const body = (
                    <>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase shrink-0 ${r.state === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                        {r.state === 'PENDING' ? 'Pending' : 'Done'}
                      </span>
                      <span className="flex-1 min-w-0">
                        <b className="font-medium">{eventLabel(r.eventName)}</b>
                        <span className="text-gray-500 font-mono text-xs ml-2">{r.marketId !== null && `#${r.marketId} `}{summarizeArgs(r.args)}</span>
                      </span>
                      <span className="text-xs text-gray-400 shrink-0">{timeAgo(r.createdAt, now)}</span>
                    </>
                  );
                  return (
                    <li key={r.id} className="flex items-center gap-3 py-2">
                      {href ? <Link href={href} className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-70">{body}</Link> : <span className="flex items-center gap-3 flex-1 min-w-0">{body}</span>}
                      <a href={txLink(r.txHash)} target="_blank" rel="noreferrer" className="text-gray-300 hover:text-gray-700 shrink-0"><ExternalLink className="w-3.5 h-3.5" /></a>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </Section>
    </div>
  );
}

/** Send-USDC card for the connected passkey (Circle) wallet. Validates a recipient + amount, shows
 *  the live balance, and routes the transfer through the tx overlay (sponsored userOp on Arc). */
function SendUsdc() {
  const { sdk, account } = useEcho();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [bal, setBal] = useState<bigint>();

  const loadBal = async () => {
    if (!account) return;
    setBal((await sdk.usdcBalanceOf(account).catch(() => undefined)) as bigint | undefined);
  };
  useEffect(() => { loadBal(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [account]);

  const validTo = /^0x[0-9a-fA-F]{40}$/.test(to.trim());
  const amt = (() => { try { return amount ? toUnits(amount) : 0n; } catch { return 0n; } })();
  const overBalance = bal !== undefined && amt > bal;
  const disabled = !account || !validTo || amt <= 0n || overBalance;

  return (
    <Card title="Send USDC" hint="A plain transfer from your smart account. Recipient receives native USDC on Arc.">
      <p className="text-xs text-gray-500">Balance: <b className="font-mono">{bal !== undefined ? usdc(bal) : '—'} USDC</b></p>
      <Field label="recipient address" value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" />
      <Field label="amount (USDC)" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      {to && !validTo && <p className="text-xs text-amber-600">Enter a valid 0x address.</p>}
      {overBalance && <p className="text-xs text-amber-600">Amount exceeds your balance.</p>}
      <Command
        label={amt > 0n && validTo ? `Send ${amount} USDC` : 'Send USDC'}
        disabled={disabled}
        onDone={loadBal}
        run={() => sdk.transferUsdc(to.trim() as `0x${string}`, amt, account!)}
      />
    </Card>
  );
}
