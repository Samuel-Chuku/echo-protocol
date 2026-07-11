'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, Download, X, Loader2, Upload } from 'lucide-react';
import type { Address } from 'viem';
import { useContent, type AttachmentRow, MAX_ATTACHMENT_BYTES } from '@/lib/content';
import type { ContentKind } from '@/lib/content';

/** Turn a base64 string into a Blob for download (no data: prefix expected). */
function base64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * File attachments for a content-channel slot ({marketId, kind, key}). Reads are gated by the indexer
 * exactly like the text body, so this is only ever shown to a party allowed to see that body. When
 * `canEdit` is set (the author of this slot), it also renders an uploader. Files ride the same channel
 * so the AI agent (#4) can read them through the same gated query.
 */
export function Attachments({
  marketId, kind, contentKey, account, canEdit = false, label = 'Attachments', compact = false,
}: {
  marketId: number; kind: ContentKind; contentKey: string; account: Address;
  canEdit?: boolean; label?: string; compact?: boolean;
}) {
  const { fetchAttachments, storeAttachment, deleteAttachment, fetchAttachmentData } = useContent();
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      setRows(await fetchAttachments(marketId, kind, contentKey, account));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load files');
    } finally { setLoading(false); }
  }, [fetchAttachments, marketId, kind, contentKey, account]);

  useEffect(() => { load(); }, [load]);

  async function onPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true); setErr(null);
    try {
      // Upload sequentially so one failure (e.g. over cap) doesn't lose the others' error clarity.
      for (const file of Array.from(files)) {
        await storeAttachment(marketId, kind, contentKey, file, account);
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function download(a: AttachmentRow) {
    setDownloading(a.id); setErr(null);
    try {
      // List responses omit the heavy base64 — fetch this file's bytes on demand.
      const full = await fetchAttachmentData(a.id, account);
      if (!full?.data) throw new Error('File data unavailable');
      const url = URL.createObjectURL(base64ToBlob(full.data, a.mime));
      const link = document.createElement('a');
      link.href = url; link.download = a.filename;
      document.body.appendChild(link); link.click(); link.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Download failed');
    } finally { setDownloading(null); }
  }

  async function remove(id: string) {
    setBusy(true); setErr(null);
    try { await deleteAttachment(id, account); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Delete failed'); }
    finally { setBusy(false); }
  }

  // Nothing to show for a read-only viewer with no files (keeps requester views clean).
  if (!canEdit && !loading && rows.length === 0 && !err) return null;

  return (
    <div className={compact ? 'mt-2' : 'mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2'}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/40 mb-1">
        <Paperclip className="w-3 h-3" /> {label}
      </div>

      {loading && <p className="text-xs text-white/40">Loading files…</p>}
      {err && <p className="text-xs text-danger break-all">{err}</p>}

      {rows.length > 0 && (
        <ul className="space-y-1">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              <button onClick={() => download(a)} disabled={downloading === a.id} className="inline-flex items-center gap-1.5 text-teal-400 hover:underline min-w-0 disabled:opacity-50">
                {downloading === a.id ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> : <Download className="w-3.5 h-3.5 shrink-0" />}
                <span className="truncate">{a.filename}</span>
              </button>
              <span className="text-xs text-white/30 shrink-0">{humanSize(a.size)}</span>
              {canEdit && a.author.toLowerCase() === account.toLowerCase() && (
                <button onClick={() => remove(a.id)} disabled={busy} className="ml-auto text-white/30 hover:text-danger shrink-0" title="Remove file">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!loading && rows.length === 0 && !err && canEdit && (
        <p className="text-xs text-white/40">No files attached yet.</p>
      )}

      {canEdit && (
        <div className="mt-2">
          <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => onPick(e.target.files)} />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1 text-xs text-white/70 hover:border-teal-500/40 hover:text-white disabled:opacity-40 transition"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Attach files
          </button>
          <span className="ml-2 text-[10px] text-white/30">docs up to {MAX_ATTACHMENT_BYTES / 1024 / 1024}MB each</span>
        </div>
      )}
    </div>
  );
}
