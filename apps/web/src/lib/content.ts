'use client';

import { useCallback } from 'react';
import { gql, useClient } from 'urql';
import type { Address } from 'viem';

/**
 * Off-chain content channel — apply bodies + per-tier deliverables that the contracts deliberately
 * don't carry (only hashes hit chain). The indexer stores plaintext in a `contents` table and
 * enforces role gating against on-chain state (apply → participant or reveal-gated requester;
 * deliver → Arc job provider / evaluator). See memory: echo-content-channel-gap.
 *
 * Demo simplification: the indexer trusts the client-claimed viewer/author address. A malicious
 * client could spoof an address and read other people's bodies — fine for testnet, NOT mainnet.
 * Replace with E2E encryption (Lit / x25519) before going live with real users.
 */

export type ContentRow = {
  id: string; marketId: number; kind: string; key: string;
  author: string; body: string; hash: string; createdAt: number;
};

export type ContentKind = 'apply' | 'deliver';

const STORE_CONTENT = gql`
  mutation StoreContent($marketId: Int!, $kind: String!, $key: String!, $body: String!, $author: String!) {
    storeContent(marketId: $marketId, kind: $kind, key: $key, body: $body, author: $author) {
      id marketId kind key author body hash createdAt
    }
  }
`;

const FETCH_CONTENT = gql`
  query FetchContent($marketId: Int!, $kind: String!, $key: String!, $viewer: String!) {
    content(marketId: $marketId, kind: $kind, key: $key, viewer: $viewer) {
      id marketId kind key author body hash createdAt
    }
  }
`;

/**
 * Plain GraphQL pass-through. Reads return null when the indexer has no row; gating violations
 * throw at the GraphQL layer ("Reveal required", "Forbidden") and the hook surfaces them so the
 * UI can render a hint.
 */
export function useContent() {
  const client = useClient();

  const store = useCallback(async (
    marketId: number, kind: ContentKind, key: string, body: string, author: Address,
  ): Promise<ContentRow> => {
    const res = await client.mutation(STORE_CONTENT, { marketId, kind, key, body, author }).toPromise();
    if (res.error) throw res.error;
    return res.data!.storeContent as ContentRow;
  }, [client]);

  const fetch = useCallback(async (
    marketId: number, kind: ContentKind, key: string, viewer: Address,
  ): Promise<ContentRow | null> => {
    const res = await client.query(
      FETCH_CONTENT, { marketId, kind, key, viewer },
      { requestPolicy: 'network-only' },
    ).toPromise();
    if (res.error) throw res.error;
    return (res.data?.content ?? null) as ContentRow | null;
  }, [client]);

  return { store, fetch };
}
