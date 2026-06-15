import { createPublicClient, http, type Chain } from 'viem';
import { arcTestnet } from '@echo/sdk';
import { config } from './config';

export const publicClient = createPublicClient({
  chain: arcTestnet as unknown as Chain,
  transport: http(config.rpcUrl),
});
