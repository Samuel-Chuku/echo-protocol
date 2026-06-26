'use client';

import { useEcho } from '@/lib/sdk';
import { useAgent } from '@/lib/agent';
import { TxModal } from './TxModal';

/**
 * Action-triggered identity registration. The always-visible IdentityBanner covers passive awareness;
 * this modal is opened from a primary CTA (Apply, Create) when the wallet has no agentId yet, so the
 * user registers in place instead of bouncing off the page.
 */
export function RegisterIdentityModal({ onClose, onRegistered }: { onClose: () => void; onRegistered?: (agentId: string) => void }) {
  const { sdk, account } = useEcho();
  const { setAgentId } = useAgent();

  return (
    <TxModal
      title="Register your Echo identity"
      description="One-time on-chain registration. This is required before you can post or apply to anything on Echo."
      confirmLabel="Register identity"
      gasEstimate="$0.006"
      run={async () => {
        const id = await sdk.registerIdentity(account!);
        setAgentId(id.toString());
        onRegistered?.(id.toString());
        return id.toString();
      }}
      onClose={onClose}
    />
  );
}
