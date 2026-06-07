import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { arcTestnet } from './chains';
import { CONTRACTS } from './constants';
import { MarketRegistryABI, EchoHookABI, ParticipationReceiptABI } from './abis';

export { arcTestnet, wagmiConfig, publicClient } from './chains';
export { CONTRACTS, IMPLEMENTATIONS, API, DEFAULT_TIERS } from './constants';
export { MarketRegistryABI, EchoHookABI, ParticipationReceiptABI } from './abis';
export * from '@echo/types';

// ═══════════════════════════════════════════════════════════
// Echo Protocol SDK
// Drop-in client for building apps on Echo.
// ═══════════════════════════════════════════════════════════

export class EchoSdk {
  public publicClient: PublicClient;
  public walletClient?: WalletClient;
  public chain = arcTestnet;
  public contracts = CONTRACTS.arcTestnet;

  constructor(rpcUrl?: string) {
    this.publicClient = createPublicClient({
      chain: arcTestnet,
      transport: http(rpcUrl || 'https://rpc.testnet.arc.network'),
    });
  }

  connectWallet(windowEthereum: any) {
    this.walletClient = createWalletClient({
      chain: arcTestnet,
      transport: custom(windowEthereum),
    });
  }

  // ── Market Read Operations ──────────────────────────────

  async getMarket(marketId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.marketRegistry,
      abi: MarketRegistryABI,
      functionName: 'getMarket',
      args: [marketId],
    });
  }

  async getMarketApplications(marketId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.marketRegistry,
      abi: MarketRegistryABI,
      functionName: 'getMarketApplications',
      args: [marketId],
    });
  }

  async getApplication(marketId: bigint, participant: Address) {
    return this.publicClient.readContract({
      address: this.contracts.marketRegistry,
      abi: MarketRegistryABI,
      functionName: 'getApplication',
      args: [marketId, participant],
    });
  }

  async getRequesterMarkets(requester: Address) {
    return this.publicClient.readContract({
      address: this.contracts.marketRegistry,
      abi: MarketRegistryABI,
      functionName: 'getRequesterMarkets',
      args: [requester],
    });
  }

  async marketCount() {
    return this.publicClient.readContract({
      address: this.contracts.marketRegistry,
      abi: MarketRegistryABI,
      functionName: 'marketCount',
    });
  }

  // ── Receipt Read Operations ─────────────────────────────

  async getReceipt(tokenId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.participationReceipt,
      abi: ParticipationReceiptABI,
      functionName: 'receipts',
      args: [tokenId],
    });
  }

  async ownerOf(tokenId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.participationReceipt,
      abi: ParticipationReceiptABI,
      functionName: 'ownerOf',
      args: [tokenId],
    });
  }

  // ── EchoHook Read Operations ────────────────────────────

  async getJobContext(jobId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.echoHook,
      abi: EchoHookABI,
      functionName: 'ctx',
      args: [jobId],
    });
  }

  async remainingEscrow(marketId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.echoHook,
      abi: EchoHookABI,
      functionName: 'remainingEscrow',
      args: [marketId],
    });
  }

  // ── Write Operations (require walletClient) ─────────────

  async createMarket(
    args: {
      metadataURI: string;
      scopeHash: `0x${string}`;
      tierAmounts: [bigint, bigint, bigint, bigint];
      minPRep: bigint;
      maxApplicants: bigint;
      ghostDeadline: bigint;
      escrowTotal: bigint;
    },
    account: Address
  ) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry,
      abi: MarketRegistryABI,
      functionName: 'createMarket',
      args: [
        args.metadataURI,
        args.scopeHash,
        args.tierAmounts,
        args.minPRep,
        args.maxApplicants,
        args.ghostDeadline,
        args.escrowTotal,
      ],
      account,
    });
    return this.walletClient.writeContract(request);
  }

  async applyToMarket(marketId: bigint, submissionHash: `0x${string}`, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry,
      abi: MarketRegistryABI,
      functionName: 'applyToMarket',
      args: [marketId, submissionHash],
      account,
    });
    return this.walletClient.writeContract(request);
  }

  async gradeSubstantive(marketId: bigint, participant: Address, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry,
      abi: MarketRegistryABI,
      functionName: 'gradeSubstantive',
      args: [marketId, participant],
      account,
    });
    return this.walletClient.writeContract(request);
  }

  async gradeShortlist(marketId: bigint, participant: Address, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry,
      abi: MarketRegistryABI,
      functionName: 'gradeShortlist',
      args: [marketId, participant],
      account,
    });
    return this.walletClient.writeContract(request);
  }

  async gradeFinal(marketId: bigint, participant: Address, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry,
      abi: MarketRegistryABI,
      functionName: 'gradeFinal',
      args: [marketId, participant],
      account,
    });
    return this.walletClient.writeContract(request);
  }

  async closeMarket(marketId: bigint, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry,
      abi: MarketRegistryABI,
      functionName: 'closeMarket',
      args: [marketId],
      account,
    });
    return this.walletClient.writeContract(request);
  }
}
