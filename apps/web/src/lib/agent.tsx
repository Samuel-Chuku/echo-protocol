'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAccount } from 'wagmi';

/**
 * The connected user's ERC-8004 agentId. Arc has no address→agentId reverse lookup, so every
 * worker/requester action threads it explicitly — we register once (IdentityBanner) and stash it in
 * localStorage so every panel can prefill it.
 *
 * The id is stored **per wallet** (`echo.agentId.<address>`): an ERC-8004 identity is owned by a
 * single address, so switching wallets must surface a fresh identity (or the register prompt) rather
 * than reusing the previous wallet's id — reusing it triggers `NotAgentOwner` on every market action.
 */
const Ctx = createContext<{ agentId: string; setAgentId: (s: string) => void }>({
  agentId: '',
  setAgentId: () => {},
});

const keyFor = (addr?: string) => (addr ? `echo.agentId.${addr.toLowerCase()}` : null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const [agentId, setState] = useState('');

  // Load this wallet's identity whenever the connected account changes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = keyFor(address);
    setState(key ? localStorage.getItem(key) ?? '' : '');
  }, [address]);

  const setAgentId = (s: string) => {
    setState(s);
    const key = keyFor(address);
    if (key && typeof window !== 'undefined') localStorage.setItem(key, s);
  };

  return <Ctx.Provider value={{ agentId, setAgentId }}>{children}</Ctx.Provider>;
}

export const useAgent = () => useContext(Ctx);
