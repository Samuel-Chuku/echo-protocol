import { createClient, cacheExchange, fetchExchange } from 'urql';

/**
 * urql client pointed at the Echo GraphQL indexer (apps/indexer, default :4000).
 * The UI reads markets/applications/activity from here instead of looping raw RPC
 * reads — this is what fixes the "RPC request failed" browse/activity path.
 */
export const gqlClient = createClient({
  url: process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4000/graphql',
  exchanges: [cacheExchange, fetchExchange],
  // Indexer is read-only + polled; skip aggressive caching of write-driven data.
  requestPolicy: 'cache-and-network',
});
