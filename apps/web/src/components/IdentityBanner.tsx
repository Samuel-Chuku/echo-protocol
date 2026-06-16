'use client';

import { UserPlus } from 'lucide-react';
import { useEcho } from '@/lib/sdk';
import { useAgent } from '@/lib/agent';
import { Command } from './Command';

/**
 * Inline identity prompt for action pages (create / apply / bounty). Echo threads an ERC-8004 agentId
 * through every market action, so a connected wallet still needs a one-time identity before it can
 * post or apply. Renders only when connected without an agentId — registers + stores it in place.
 */
export function IdentityBanner() {
  const { sdk, account } = useEcho();
  const { agentId, setAgentId } = useAgent();

  if (!account || agentId) return null;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
      <UserPlus className="h-4 w-4 shrink-0 text-gray-500" />
      <p className="flex-1 min-w-[12rem] text-sm text-gray-700">
        <b className="font-semibold">Register an Echo identity</b> to post or apply — a one-time on-chain
        registration (~$0.006 in USDC gas). Required before any market action.
      </p>
      <Command
        label="Register identity"
        run={async () => {
          const id = await sdk.registerIdentity(account);
          setAgentId(id.toString());
          return id.toString();
        }}
      />
    </div>
  );
}
