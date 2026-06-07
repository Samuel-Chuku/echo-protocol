'use client';

import { useMemo } from 'react';
import { EchoSdk } from '@echo/sdk';

export function useEchoSdk() {
  return useMemo(() => new EchoSdk(), []);
}
