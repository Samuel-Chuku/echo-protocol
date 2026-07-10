import { createClient, cacheExchange, fetchExchange } from 'urql';
import { getSessionToken } from './session-token';

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
  // Attach the SIWE session token (if signed in) so content-channel writes/reads are proven against
  // the wallet, not a client-claimed address. Evaluated per request — picks up sign-in/out live.
  fetchOptions: () => {
    const token = getSessionToken();
    return token ? { headers: { authorization: `Bearer ${token}` } } : {};
  },
});
