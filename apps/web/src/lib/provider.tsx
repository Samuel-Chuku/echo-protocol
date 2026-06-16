'use client';

import '@rainbow-me/rainbowkit/styles.css';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { Provider as UrqlProvider } from 'urql';
import { config } from './wagmi';
import { AgentProvider } from './agent';
import { TxProvider } from './tx';
import { gqlClient } from './gql';

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <UrqlProvider value={gqlClient}>
            <AgentProvider>
              <TxProvider>{children}</TxProvider>
            </AgentProvider>
          </UrqlProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
