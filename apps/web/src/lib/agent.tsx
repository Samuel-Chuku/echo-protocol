'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * The connected user's ERC-8004 agentId. Arc has no address→agentId reverse lookup, so every
 * worker/requester action threads it explicitly — we register once (WalletBar) and stash it in
 * localStorage so every panel can prefill it. This is a console convenience; a real app would
 * resolve it from the indexer / a profile.
 */
const Ctx = createContext<{ agentId: string; setAgentId: (s: string) => void }>({
  agentId: '',
  setAgentId: () => {},
});

export function AgentProvider({ children }: { children: ReactNode }) {
  const [agentId, setState] = useState('');
  useEffect(() => {
    const v = typeof window !== 'undefined' ? localStorage.getItem('echo.agentId') : null;
    if (v) setState(v);
  }, []);
  const setAgentId = (s: string) => {
    setState(s);
    if (typeof window !== 'undefined') localStorage.setItem('echo.agentId', s);
  };
  return <Ctx.Provider value={{ agentId, setAgentId }}>{children}</Ctx.Provider>;
}

export const useAgent = () => useContext(Ctx);
