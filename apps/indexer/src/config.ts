import 'dotenv/config';
import { CONTRACTS } from '@echo/sdk';

export const config = {
  rpcUrl: process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
  dbFile: process.env.DATABASE_FILE || './echo-indexer.db',
  startBlock: BigInt(process.env.START_BLOCK || '46035076'), // earliest Echo deploy block on Arc
  batchSize: BigInt(process.env.BATCH_SIZE || '2000'),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || '4000'),
  port: Number(process.env.PORT || '4000'),
  contracts: CONTRACTS.arcTestnet,
};
