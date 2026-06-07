'use client';

import { useAccount } from 'wagmi';
import { ConnectButton } from '@/components/ConnectButton';

/**
 * Echo Protocol — Main Dashboard
 *
 * This is the handoff skeleton for the frontend developer.
 * Key integration points:
 *   - wagmi hooks for wallet connection
 *   - @echo/sdk for contract interactions
 *   - @echo/types for shared type definitions
 *
 * TODO (frontend branch):
 *   1. Market list: use useEchoSdk() -> getMarketCount() + getMarket()
 *   2. Create market form: calls sdk.createMarket() after USDC approve
 *   3. Apply form: calls sdk.applyToMarket() with submission hash
 *   4. Grading UI: requester-only buttons for gradeSubstantive/Shortlist/Final
 *   5. Profile page: read reputation from indexer + participation receipts
 *   6. Real-time updates: subscribe to contract events via viem watchContractEvent
 */

export default function Home() {
  const { isConnected, address } = useAccount();

  return (
    <main className="min-h-screen p-8 max-w-5xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between mb-12">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Echo Protocol</h1>
          <p className="text-gray-500 mt-1">Reputation-gated agent marketplace</p>
        </div>
        <ConnectButton />
      </header>

      {/* Wallet Status */}
      <section className="mb-8 p-4 bg-gray-50 rounded-xl border border-gray-200">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Wallet Status
        </h2>
        {isConnected ? (
          <div className="space-y-1">
            <p className="text-sm">
              <span className="text-gray-500">Connected:</span>{' '}
              <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">{address}</code>
            </p>
            <p className="text-sm text-gray-500">
              Chain: Arc Testnet (5042002)
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            Connect your MetaMask wallet to interact with Echo markets.
          </p>
        )}
      </section>

      {/* Market Dashboard */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Markets</h2>
          <button className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-500 transition opacity-50 cursor-not-allowed" disabled>
            + Create Market
          </button>
        </div>

        <div className="grid gap-4">
          <div className="p-6 bg-gray-50 rounded-xl border border-dashed border-gray-300 text-center text-gray-400">
            <p className="text-sm">No markets to display.</p>
            <p className="text-xs mt-1">Implement market fetching here.</p>
          </div>
        </div>
      </section>

      {/* Integration Guide for Frontend Dev */}
      <section className="p-6 bg-blue-50 rounded-xl border border-blue-100">
        <h2 className="text-sm font-semibold text-blue-800 uppercase tracking-wider mb-3">
          Frontend Handoff — Next Steps
        </h2>
        <ul className="space-y-2 text-sm text-blue-700">
          <li className="flex gap-2">
            <span className="font-mono text-xs bg-blue-100 px-1.5 rounded">1</span>
            <span><strong>Install deps:</strong> <code>cd apps/web && pnpm install</code></span>
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-xs bg-blue-100 px-1.5 rounded">2</span>
            <span><strong>Run dev:</strong> <code>pnpm dev</code> (Next.js on localhost:3000)</span>
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-xs bg-blue-100 px-1.5 rounded">3</span>
            <span><strong>Read markets:</strong> Use <code>useEchoSdk()</code> hook → <code>sdk.getMarket(id)</code></span>
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-xs bg-blue-100 px-1.5 rounded">4</span>
            <span><strong>Create market:</strong> USDC approve → <code>sdk.createMarket(args, account)</code></span>
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-xs bg-blue-100 px-1.5 rounded">5</span>
            <span><strong>Apply:</strong> <code>sdk.applyToMarket(marketId, hash, account)</code></span>
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-xs bg-blue-100 px-1.5 rounded">6</span>
            <span><strong>Grade:</strong> Requester calls <code>sdk.gradeSubstantive/Shortlist/Final</code></span>
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-xs bg-blue-100 px-1.5 rounded">7</span>
            <span><strong>Indexer:</strong> GraphQL at <code>{process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4000/graphql'}</code></span>
          </li>
        </ul>
        <p className="text-xs text-blue-500 mt-4">
          See <code>apps/web/src/hooks/useEchoSdk.ts</code> and <code>packages/sdk/src/index.ts</code> for full API.
        </p>
      </section>

      {/* Contract Addresses */}
      <footer className="mt-12 pt-6 border-t border-gray-200 text-xs text-gray-400 space-y-1">
        <p>Arc Testnet Contracts:</p>
        <p>MarketRegistry: 0x6ce0...e333dc | EchoHook: 0x6333...84866 | Receipt: 0xb767...7da0</p>
      </footer>
    </main>
  );
}
