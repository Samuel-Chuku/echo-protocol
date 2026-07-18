import fs from 'node:fs';
import path from 'node:path';

/**
 * Tee console output to a file so the ops dashboard can tail it (GET /api/logs on ops).
 * Enabled only when LOG_FILE is set (docker-compose points it at the shared `echo_logs` volume);
 * local dev without the env var is untouched. Same helper exists in apps/ops — keep in sync.
 *
 * Single-file rotation: when the file passes MAX_BYTES it's renamed to `<file>.1` (replacing the
 * previous one), so disk use is bounded at ~2×MAX and the tail endpoint always reads a fresh file.
 * NOTE this captures console.* from THIS process only — crashes before init, or docker-level
 * events, still live in `docker compose logs`.
 */
const MAX_BYTES = 5 * 1024 * 1024;
const LEVELS = ['log', 'info', 'warn', 'error'] as const;

export function teeConsoleToFile(): void {
  const file = process.env.LOG_FILE;
  if (!file) return;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { return; }

  const write = (level: string, args: unknown[]) => {
    try {
      const text = args
        .map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' ');
      try { if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`); } catch { /* first write */ }
      fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${text}\n`);
    } catch { /* never let logging break the app */ }
  };

  for (const level of LEVELS) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => { orig(...args); write(level, args); };
  }
}
