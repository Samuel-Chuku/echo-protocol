import { createPublicClient, createWalletClient, custom, http, Address } from 'viem';
import { arcTestnet } from './chains';
import { CONTRACTS } from './constants';

// Re-export for convenience
export { arcTestnet } from './chains';
export { CONTRACTS, DEFAULT_TIERS } from './constants';
export * from '@echo/types';

/**
 * Echo Protocol SDK
 * Drop-in client for building vertical apps on top of Echo.
 */
export class EchoSdk {
  public publicClient;
  public walletClient;
  public chain = arcTestnet;

  constructor(rpcUrl?: string) {
    this.publicClient = createPublicClient({
      chain: arcTestnet,
      transport: http(rpcUrl),
    });
  }

  connectWallet(windowEthereum: any) {
    this.walletClient = createWalletClient({
      chain: arcTestnet,
      transport: custom(windowEthereum),
    });
  }

  // Market queries
  async getMarket(marketId: string) {
    return this.publicClient.readContract({
      address: CONTRACTS.arcTestnet.marketRegistry,
      abi: marketRegistryAbi, // TODO: import from compiled ABI
      functionName: 'getMarket',
      args: [BigInt(marketId)],
    });
  }

  // Application mutations
  // TODO: Implement all contract interactions
}

// TODO: Import generated ABIs from compiled contracts
const marketRegistryAbi: any[] = [];
