'use client';

import { createContext, useContext, useEffect, useState } from 'react';

/**
 * Reads the operator feature flags published by apps/ops at NEXT_PUBLIC_OPS_FLAGS_URL
 * (GET /api/flags/public → { "web.maintenance": false, ... }). Polls every 30s.
 *
 * Fails OPEN: if the ops panel is unset or unreachable, flags stay empty, so every gate reads
 * `false` and the site behaves normally. A down dashboard must never take the app down.
 */
type Flags = Record<string, boolean>;

const FlagsContext = createContext<Flags>({});
const FLAGS_URL = process.env.NEXT_PUBLIC_OPS_FLAGS_URL || '';

export function FlagsProvider({ children }: { children: React.ReactNode }) {
  const [flags, setFlags] = useState<Flags>({});

  useEffect(() => {
    if (!FLAGS_URL) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(FLAGS_URL, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (alive && data && typeof data === 'object') setFlags(data as Flags);
      } catch {
        /* fail open — leave the last known flags in place */
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return <FlagsContext.Provider value={flags}>{children}</FlagsContext.Provider>;
}

export function useFlags(): Flags {
  return useContext(FlagsContext);
}

export function useFlag(key: string): boolean {
  return Boolean(useContext(FlagsContext)[key]);
}
