'use client';

import { useCallback } from 'react';
import { useSignMessage } from 'wagmi';
import { gql, useClient } from 'urql';
import type { Address } from 'viem';

/**
 * Off-chain content channel — talks to the indexer's storeContent mutation and gated content query.
 * The contracts only carry hashes; the actual text (apply bodies, per-tier deliverables) lives in
 * the indexer's `contents` table behind a wallet-signature gate. See memory: echo-content-channel-gap.
 *
 * Auth envelope: caller signs a freshness-stamped message, indexer verifies via verifyMessage
 * (EOA + EIP-1271 / Circle modular wallets). Reveal-gated for apply content; Arc job role-gated
 * for deliverables — gating policy is enforced server-side.
 */

export type ContentAuth = { address: Address; message: string; signature: `0x${string}` };
export type ContentRow = {
  id: string; marketId: number; kind: string; key: string;
  author: string; body: string; hash: string; createdAt: number;
};

export type ContentKind = 'apply' | 'deliver';

/** Stable message format — kept readable so wallets show users what they're authorizing. */
function buildMessage(op: 'read' | 'write', marketId: number, kind: ContentKind, key: string): string {
  const ts = Math.floor(Date.now() / 1000);
  return [
    `Echo content ${op}`,
    `market=${marketId}`,
    `kind=${kind}`,
    `key=${key.toLowerCase()}`,
    `ts=${ts}`,
  ].join('\n');
}

const STORE_CONTENT = gql`
  mutation StoreContent($marketId: Int!, $kind: String!, $key: String!, $body: String!, $auth: ContentAuthInput!) {
    storeContent(marketId: $marketId, kind: $kind, key: $key, body: $body, auth: $auth) {
      id marketId kind key author body hash createdAt
    }
  }
`;

const FETCH_CONTENT = gql`
  query FetchContent($marketId: Int!, $kind: String!, $key: String!, $auth: ContentAuthInput!) {
    content(marketId: $marketId, kind: $kind, key: $key, auth: $auth) {
      id marketId kind key author body hash createdAt
    }
  }
`;

/**
 * Sign + send. Reads return null when the indexer has no row OR the caller fails the gate (gating
 * errors throw at the GraphQL level — the hook surfaces them so the UI can render a hint).
 */
export function useContent() {
  const client = useClient();
  const { signMessageAsync } = useSignMessage();

  const sign = useCallback(async (
    op: 'read' | 'write', marketId: number, kind: ContentKind, key: string, address: Address,
  ): Promise<ContentAuth> => {
    const message = buildMessage(op, marketId, kind, key);
    const signature = await signMessageAsync({ message, account: address });
    return { address, message, signature };
  }, [signMessageAsync]);

  const store = useCallback(async (
    marketId: number, kind: ContentKind, key: string, body: string, address: Address,
  ): Promise<ContentRow> => {
    const auth = await sign('write', marketId, kind, key, address);
    const res = await client.mutation(STORE_CONTENT, { marketId, kind, key, body, auth }).toPromise();
    if (res.error) throw res.error;
    return res.data!.storeContent as ContentRow;
  }, [client, sign]);

  const fetch = useCallback(async (
    marketId: number, kind: ContentKind, key: string, address: Address,
  ): Promise<ContentRow | null> => {
    const auth = await sign('read', marketId, kind, key, address);
    const res = await client.query(FETCH_CONTENT, { marketId, kind, key, auth }, { requestPolicy: 'network-only' }).toPromise();
    if (res.error) throw res.error;
    return (res.data?.content ?? null) as ContentRow | null;
  }, [client, sign]);

  return { store, fetch };
}
