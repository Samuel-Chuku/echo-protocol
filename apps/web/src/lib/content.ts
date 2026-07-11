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

export type ContentKind = 'apply' | 'deliver' | 'reject' | 'preview';

export type AttachmentRow = {
  id: string; marketId: number; kind: string; key: string;
  author: string; filename: string; mime: string; size: number; hash: string; createdAt: number;
  data?: string | null; // null in list responses (metadata-only); populated by fetchAttachmentData
};

/** Docs-only cap, mirrors the indexer's MAX_ATTACHMENT_BYTES so we reject client-side before upload. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

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

const FETCH_ATTACHMENTS = gql`
  query FetchAttachments($marketId: Int!, $kind: String!, $key: String!, $viewer: String!) {
    attachments(marketId: $marketId, kind: $kind, key: $key, viewer: $viewer) {
      id marketId kind key author filename mime size hash createdAt
    }
  }
`;

const FETCH_ATTACHMENT_DATA = gql`
  query FetchAttachmentData($id: String!, $viewer: String!) {
    attachmentData(id: $id, viewer: $viewer) {
      id filename mime data
    }
  }
`;

const STORE_ATTACHMENT = gql`
  mutation StoreAttachment($marketId: Int!, $kind: String!, $key: String!, $filename: String!, $mime: String!, $data: String!, $author: String!) {
    storeAttachment(marketId: $marketId, kind: $kind, key: $key, filename: $filename, mime: $mime, data: $data, author: $author) {
      id marketId kind key author filename mime size data hash createdAt
    }
  }
`;

const DELETE_ATTACHMENT = gql`
  mutation DeleteAttachment($id: String!, $author: String!) {
    deleteAttachment(id: $id, author: $author)
  }
`;

/** Read a browser File as base64 (no data: prefix) for upload. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string; // "data:<mime>;base64,<payload>"
      resolve(res.includes(',') ? res.slice(res.indexOf(',') + 1) : res);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

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
    // No per-action sign-in prompt: ownership is proven once by the auto-SIWE flow on connect
    // (see AuthProvider). If a session exists, its token rides on the request header (gql.ts) and
    // the indexer enforces author == signed-in address; otherwise the legacy path applies until
    // REQUIRE_AUTH is turned on.
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

  // ── File attachments — same channel, same gate (see indexer assertCanReadContent/Write). ──

  const fetchAttachments = useCallback(async (
    marketId: number, kind: ContentKind, key: string, viewer: Address,
  ): Promise<AttachmentRow[]> => {
    const res = await client.query(
      FETCH_ATTACHMENTS, { marketId, kind, key, viewer },
      { requestPolicy: 'network-only' },
    ).toPromise();
    if (res.error) throw res.error;
    return (res.data?.attachments ?? []) as AttachmentRow[];
  }, [client]);

  const storeAttachment = useCallback(async (
    marketId: number, kind: ContentKind, key: string, file: File, author: Address,
  ): Promise<AttachmentRow> => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB).`);
    }
    const data = await fileToBase64(file);
    const res = await client.mutation(STORE_ATTACHMENT, {
      marketId, kind, key, filename: file.name, mime: file.type || 'application/octet-stream', data, author,
    }).toPromise();
    if (res.error) throw res.error;
    return res.data!.storeAttachment as AttachmentRow;
  }, [client]);

  const deleteAttachment = useCallback(async (id: string, author: Address): Promise<boolean> => {
    const res = await client.mutation(DELETE_ATTACHMENT, { id, author }).toPromise();
    if (res.error) throw res.error;
    return Boolean(res.data?.deleteAttachment);
  }, [client]);

  /** Fetch one attachment's base64 bytes on demand (list responses omit `data`). */
  const fetchAttachmentData = useCallback(async (
    id: string, viewer: Address,
  ): Promise<{ id: string; filename: string; mime: string; data: string } | null> => {
    const res = await client.query(
      FETCH_ATTACHMENT_DATA, { id, viewer }, { requestPolicy: 'network-only' },
    ).toPromise();
    if (res.error) throw res.error;
    return (res.data?.attachmentData ?? null) as { id: string; filename: string; mime: string; data: string } | null;
  }, [client]);

  return { store, fetch, fetchAttachments, storeAttachment, deleteAttachment, fetchAttachmentData };
}
