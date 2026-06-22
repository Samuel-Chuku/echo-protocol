'use client';

import '@rainbow-me/rainbowkit/styles.css';
import { type State, WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { Provider as UrqlProvider } from 'urql';
import { config } from './wagmi';
import { AgentProvider } from './agent';
import { TxProvider } from './tx';
import { gqlClient } from './gql';

const queryClient = new QueryClient();

// `initialState` from cookies is forwarded by the root layout (server side) so wagmi can hydrate
// without flicker. `reconnectOnMount` (default true) then re-establishes the connector session.
export function Providers({ children, initialState }: { children: React.ReactNode; initialState?: State }) {
  return (
    <WagmiProvider config={config} initialState={initialState}>
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
