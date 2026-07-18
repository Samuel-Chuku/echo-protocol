import fs from 'node:fs';
import path from 'node:path';

/**
 * Tail reader for the shared log volume (see logfile.ts in each app + the `echo_logs` volume in
 * docker-compose). Whitelisted per app — the query param never touches the filesystem path, so no
 * traversal. Reads only the last TAIL_BYTES of the file per request; with the 5MB cap in
 * logfile.ts a poll is at most one small read, cheap enough for the dashboard's auto-refresh.
 */
const LOG_DIR = process.env.LOG_DIR || '/var/log/echo';
const FILES: Record<string, string> = {
  indexer: path.join(LOG_DIR, 'indexer.log'),
  ops: path.join(LOG_DIR, 'ops.log'),
};
const TAIL_BYTES = 256 * 1024;
const MAX_LINES = 1000;

export function logApps(): string[] {
  return Object.keys(FILES);
}

export function tailLog(app: string, lines: number): { app: string; lines: string[]; size: number; mtime: number } {
  const file = FILES[app];
  if (!file) throw new Error(`unknown app '${app}' — one of: ${Object.keys(FILES).join(', ')}`);
  const n = Math.max(1, Math.min(Number(lines) || 200, MAX_LINES));

  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return { app, lines: [`(no log file yet at ${file} — is LOG_FILE set on the ${app} container?)`], size: 0, mtime: 0 };
  }

  const start = Math.max(0, st.size - TAIL_BYTES);
  const buf = Buffer.alloc(st.size - start);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buf, 0, buf.length, start);
  } finally {
    fs.closeSync(fd);
  }
  let all = buf.toString('utf8').split('\n');
  if (start > 0 && all.length > 1) all = all.slice(1); // drop the partial first line of a mid-file read
  if (all[all.length - 1] === '') all.pop();
  return { app, lines: all.slice(-n), size: st.size, mtime: Math.floor(st.mtimeMs / 1000) };
}
