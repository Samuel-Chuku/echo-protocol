import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseEventLogs,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { arcTestnet } from './chain';
import { CONTRACTS } from './constants';
import {
  MarketRegistryABI,
  EchoHookABI,
  ParticipationReceiptABI,
  AttributionRegistryABI,
  AttributionPayoutABI,
  DisputeResolverABI,
} from './abis';

export { arcTestnet, publicClient } from './chain';
export { CONTRACTS, IMPLEMENTATIONS, LIBRARIES, API, DEFAULT_TIERS } from './constants';
export {
  MarketRegistryABI,
  EchoHookABI,
  ParticipationReceiptABI,
  AttributionRegistryABI,
  AttributionPayoutABI,
  DisputeResolverABI,
} from './abis';
export * from '@echo/types';

// ═══════════════════════════════════════════════════════════
// Attribution enums — mirror AttributionRegistry.sol on-chain order.
// Pass the numeric value to proposeAR (viem encodes uint8).
// ═══════════════════════════════════════════════════════════

/** AttributionType — why an introducer is credited. */
export enum AttributionType {
  Introduced = 0,
  Vouched = 1,
  Trained = 2,
  Matched = 3,
  Referred = 4,
}

/** CurveType — how an AR's slice decays over time. */
export enum CurveType {
  Linear = 0, // decays linearly to zero over durationSecs
  FlatPerpetual = 1, // never decays (override)
  VolumeCap = 2, // pays until cumulative volumeCap is reached
}

/** Max attribution slice an AR may claim, in basis points (5000 = 50%). */
export const MAX_SLICE_BPS = 5000;

/** Market shape (mirrors MarketRegistry.Mode on-chain order). P1 supports OpenMarket via
 *  createMarketWithMode; DirectJob/Bounty have their own create* entrypoints. */
export enum EchoMode {
  OpenMarket = 0,
  DirectJob = 1,
  Bounty = 2,
}

// ═══════════════════════════════════════════════════════════
// Job metadata — `{subject, description}` JSON carried in the on-chain
// `metadataURI` (a free string; contracts unchanged). The indexer parses
// the same shape in apps/indexer/src/indexer/reducers.ts — keep them in sync.
// ═══════════════════════════════════════════════════════════

/** Human-readable job metadata stored in `metadataURI`. */
export interface JobMetadata {
  subject?: string;
  description?: string;
}

/** Encode `{subject, description}` into the string passed as `metadataURI` on any create* method. */
export function buildMetadata(meta: JobMetadata): string {
  return JSON.stringify({ subject: meta.subject ?? '', description: meta.description ?? '' });
}

/** Decode a `metadataURI` back into `{subject, description}`. Tolerates `data:` URIs and
 *  non-JSON legacy values (returns `{}`). Mirrors the indexer's `parseMetadata`. */
export function parseMetadata(uri: unknown): JobMetadata {
  if (typeof uri !== 'string' || !uri) return {};
  try {
    const raw = uri.startsWith('data:') ? decodeURIComponent(uri.slice(uri.indexOf(',') + 1)) : uri;
    const j = JSON.parse(raw);
    return { subject: j.subject, description: j.description };
  } catch {
    return {};
  }
}

/** Mode + entry config for createMarketWithMode (mirrors MarketRegistry.ModeConfig). `flagWindow`
 *  must be > 0 when `stakeRequired` > 0 (the held reveal stake needs a flag window). */
export interface ModeConfig {
  mode: EchoMode;
  requiredProofs: bigint;
  stakeRequired: bigint;
  flagWindow: bigint;
}

/** Minimal ERC-20 ABI — just what the SDK needs to approve/read USDC. */
const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * Minimal ERC-8004 IdentityRegistry ABI. Arc's registry is an ERC-721 with NO
 * address→agentId reverse lookup, so callers register to obtain their agentId
 * (read it from the ERC-721 Transfer event of the register tx) and pass it explicitly.
 */
const IDENTITY_ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'uri', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'isAuthorizedOrOwner',
    stateMutability: 'view',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'agentId', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
] as const;

export { IDENTITY_ABI };

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

  /**
   * Send a simulated `request` via the wallet client.
   *
   * If the wallet client carries a LOCAL account (a private-key signer, e.g. scripts and
   * the e2e), pass that account object so viem signs locally and broadcasts via
   * `eth_sendRawTransaction`. Address-only accounts make viem fall back to
   * `wallet_sendTransaction` (node-side signing), which Arc's public RPC rejects with
   * "this request method is not supported". With an injected browser wallet there is no
   * local account, so we leave the request as-is and let the wallet sign.
   */
  private send(request: any) {
    const local = this.walletClient!.account;
    return local
      ? this.walletClient!.writeContract({ ...request, account: local })
      : this.walletClient!.writeContract(request);
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

  /** Protocol take-rate in basis points (live config; 500 = 5%). */
  async protocolFeeBps() {
    return this.publicClient.readContract({
      address: this.contracts.echoHook,
      abi: EchoHookABI,
      functionName: 'protocolFeeBps',
    });
  }

  /** Wallet that receives the protocol fee margin. */
  async protocolTreasury() {
    return this.publicClient.readContract({
      address: this.contracts.echoHook,
      abi: EchoHookABI,
      functionName: 'protocolTreasury',
    });
  }

  /** Requester-funded introducer pool balances for a market (base units). */
  async getPoolBalances(marketId: bigint) {
    const [escrowed, distributed, shareBps] = await Promise.all([
      this.publicClient.readContract({
        address: this.contracts.echoHook,
        abi: EchoHookABI,
        functionName: 'poolEscrowed',
        args: [marketId],
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.contracts.echoHook,
        abi: EchoHookABI,
        functionName: 'poolDistributed',
        args: [marketId],
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.contracts.echoHook,
        abi: EchoHookABI,
        functionName: 'poolShareBps',
        args: [marketId],
      }) as Promise<number>,
    ]);
    return { escrowed, distributed, remaining: escrowed - distributed, shareBps };
  }

  // ── Attribution Read Operations ─────────────────────────

  /** Total number of ARs ever proposed (also the highest AR id). */
  async arCount() {
    return this.publicClient.readContract({
      address: this.contracts.attributionRegistry,
      abi: AttributionRegistryABI,
      functionName: 'arCount',
    });
  }

  /** Full AR struct (originator, slice, curve, confirmed/revoked, paidToDate, …). */
  async getAR(arId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.attributionRegistry,
      abi: AttributionRegistryABI,
      functionName: 'getAR',
      args: [arId],
    });
  }

  /** All AR ids proposed against a given worker agent. */
  async getWorkerARs(workerAgentId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.attributionRegistry,
      abi: AttributionRegistryABI,
      functionName: 'getWorkerARs',
      args: [workerAgentId],
    });
  }

  /**
   * The worker's first confirmed, non-revoked introducer.
   * Returns `[originator, exists]`; `exists` is false if none is confirmed yet.
   */
  async primaryIntroducer(workerAgentId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.attributionRegistry,
      abi: AttributionRegistryABI,
      functionName: 'primaryIntroducer',
      args: [workerAgentId],
    });
  }

  /** Whether `requester` has graded `workerAgentId` (gates confirmAR, anti-sybil). */
  async hasGraded(workerAgentId: bigint, requester: Address) {
    return this.publicClient.readContract({
      address: this.contracts.attributionRegistry,
      abi: AttributionRegistryABI,
      functionName: 'gradedBy',
      args: [workerAgentId, requester],
    });
  }

  // ── USDC Read Operations ────────────────────────────────

  async usdcBalanceOf(account: Address) {
    return this.publicClient.readContract({
      address: this.contracts.usdc,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account],
    });
  }

  async usdcAllowance(owner: Address, spender: Address) {
    return this.publicClient.readContract({
      address: this.contracts.usdc,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [owner, spender],
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
      requesterAgentId: bigint;
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
        args.requesterAgentId,
      ],
      account,
    });
    return this.send(request);
  }

  async applyToMarket(
    marketId: bigint,
    agentId: bigint,
    submissionHash: `0x${string}`,
    account: Address
  ) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry,
      abi: MarketRegistryABI,
      functionName: 'applyToMarket',
      args: [marketId, agentId, submissionHash],
      account,
    });
    return this.send(request);
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
    return this.send(request);
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
    return this.send(request);
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
    return this.send(request);
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
    return this.send(request);
  }

  /**
   * Trigger the Echo-native ghost penalty for a participant whose Final-tier job
   * passed its ghost deadline uncompleted. Permissionless on-chain (anyone may call).
   */
  async triggerGhost(marketId: bigint, participant: Address, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry,
      abi: MarketRegistryABI,
      functionName: 'triggerGhost',
      args: [marketId, participant],
      account,
    });
    return this.send(request);
  }

  // ── ERC-8004 Identity ───────────────────────────────────
  // Arc's IdentityRegistry has no address→agentId reverse lookup, so every
  // worker/requester action threads the agentId explicitly. Register once, then
  // reuse the returned id for applyToMarket / createMarket.

  /**
   * Register a fresh ERC-8004 agent identity for `account` and return the new
   * agentId. Reads the tokenId from the ERC-721 Transfer event of the register tx.
   */
  async registerIdentity(account: Address, uri = ''): Promise<bigint> {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.identityRegistry,
      abi: IDENTITY_ABI,
      functionName: 'register',
      args: [uri],
      account,
    });
    const hash = await this.send(request);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    const logs = parseEventLogs({
      abi: IDENTITY_ABI,
      logs: receipt.logs,
      eventName: 'Transfer',
    });
    const minted = logs.find(
      (l: any) =>
        l.args?.from === '0x0000000000000000000000000000000000000000' &&
        (l.args?.to as string)?.toLowerCase() === account.toLowerCase()
    ) as any;
    if (!minted) throw new Error('register: no Transfer(mint) event found');
    return minted.args.tokenId as bigint;
  }

  /** ERC-721 owner of an agent identity. */
  async agentOwner(agentId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.identityRegistry,
      abi: IDENTITY_ABI,
      functionName: 'ownerOf',
      args: [agentId],
    });
  }

  /** True if `spender` controls `agentId` (owner / approved / agent wallet). */
  async isAuthorizedOrOwner(spender: Address, agentId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.identityRegistry,
      abi: IDENTITY_ABI,
      functionName: 'isAuthorizedOrOwner',
      args: [spender, agentId],
    });
  }

  /** Number of agent identities held by `owner` (0 means unregistered). */
  async identityBalanceOf(owner: Address) {
    return this.publicClient.readContract({
      address: this.contracts.identityRegistry,
      abi: IDENTITY_ABI,
      functionName: 'balanceOf',
      args: [owner],
    });
  }

  // ── Attribution Write Operations ────────────────────────

  /**
   * Propose an Attribution Receipt. `account` becomes the AR's originator
   * (the introducer who gets paid). The AR is inert until an independent
   * requester who graded the worker co-signs via {@link confirmAR}.
   *
   * @param sliceBps share of each payout, ≤ {@link MAX_SLICE_BPS} (5000 = 50%).
   * @returns the tx hash; read the new id via {@link arCount} / events.
   */
  async proposeAR(
    args: {
      workerAgentId: bigint;
      attributionType: AttributionType;
      sliceBps: number;
      curve: CurveType;
      durationSecs: number;
      volumeCap: bigint;
    },
    account: Address
  ) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    if (args.sliceBps > MAX_SLICE_BPS) {
      throw new Error(`sliceBps ${args.sliceBps} exceeds MAX_SLICE_BPS ${MAX_SLICE_BPS}`);
    }
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.attributionRegistry,
      abi: AttributionRegistryABI,
      functionName: 'proposeAR',
      args: [
        args.workerAgentId,
        args.attributionType,
        args.sliceBps,
        args.curve,
        args.durationSecs,
        args.volumeCap,
      ],
      account,
    });
    return this.send(request);
  }

  /**
   * Confirm a proposed AR. `confirmingRequester` must (a) differ from the
   * AR's originator and (b) have already graded the worker — otherwise the
   * call reverts (anti-sybil). Typically called by that requester's account.
   */
  async confirmAR(arId: bigint, confirmingRequester: Address, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.attributionRegistry,
      abi: AttributionRegistryABI,
      functionName: 'confirmAR',
      args: [arId, confirmingRequester],
      account,
    });
    return this.send(request);
  }

  /**
   * Revoke an AR you originated (or as registry owner). Stops future payouts.
   */
  async revokeAR(arId: bigint, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.attributionRegistry,
      abi: AttributionRegistryABI,
      functionName: 'revoke',
      args: [arId],
      account,
    });
    return this.send(request);
  }

  /**
   * Fund a market's introducer pool. Routed through MarketRegistry (only the
   * market's requester may call). Pulls `amount` USDC from `account`, so
   * approve MarketRegistry for at least `amount` first via {@link approveUSDC}.
   *
   * @param introducerShareBps share of the worker's payout paid to their
   *   introducer on tier advancement, ≤ 10000.
   */
  async fundAttributionPool(
    marketId: bigint,
    amount: bigint,
    introducerShareBps: number,
    account: Address
  ) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry,
      abi: MarketRegistryABI,
      functionName: 'fundAttributionPool',
      args: [marketId, amount, introducerShareBps],
      account,
    });
    return this.send(request);
  }

  /**
   * Approve a spender (e.g. MarketRegistry) to pull USDC from `account`.
   * Required before {@link createMarket} and {@link fundAttributionPool}.
   */
  async approveUSDC(spender: Address, amount: bigint, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.usdc,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, amount],
      account,
    });
    return this.send(request);
  }

  /**
   * Per-action approve: if `account`'s allowance to `spender` is below `amount`, approve **exactly**
   * `amount` and wait for the approve to mine; otherwise do nothing. Returns the approve tx hash (or
   * null when the existing allowance already covers it). Lets a create/fund flow pull only what it
   * needs — no large standing allowance.
   */
  async ensureUsdcAllowance(spender: Address, amount: bigint, account: Address): Promise<`0x${string}` | null> {
    const current = (await this.usdcAllowance(account, spender)) as bigint;
    if (current >= amount) return null;
    const hash = (await this.approveUSDC(spender, amount, account)) as `0x${string}`;
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // ── Mode + entry reads (P1/P6) ──────────────────────────

  /** Selected market shape (see {@link EchoMode}). */
  async marketMode(marketId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'marketMode', args: [marketId],
    }) as Promise<number>;
  }

  /** Per-applicant returnable stake S (base units; 0 = none). */
  async marketStakeRequired(marketId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'marketStakeRequired', args: [marketId],
    }) as Promise<bigint>;
  }

  /** Requester's accepted-proof bitmask for entry. */
  async marketRequiredProofs(marketId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'marketRequiredProofs', args: [marketId],
    }) as Promise<bigint>;
  }

  /** Reveal fee R for a reveal market (0 = not a reveal market). */
  async revealFee(marketId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'revealFee', args: [marketId],
    }) as Promise<bigint>;
  }

  /** Seconds the requester has to flag a reveal as bait-and-switch (P6). */
  async revealFlagWindow(marketId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'revealFlagWindow', args: [marketId],
    }) as Promise<bigint>;
  }

  // ── Requester: mode market create + Mode-A reveal (P1/P6) ─

  /**
   * Create a market with an explicit mode + genesis filter. P1 supports OpenMarket (a reveal market
   * when `cfg.stakeRequired`/`flagWindow` are set); DirectJob/Bounty have their own create* methods.
   * Escrow is pulled from `account` — approve MarketRegistry for `escrowTotal` first.
   */
  async createMarketWithMode(
    args: {
      metadataURI: string;
      scopeHash: `0x${string}`;
      tierAmounts: [bigint, bigint, bigint, bigint];
      minPRep: bigint;
      maxApplicants: bigint;
      ghostDeadline: bigint;
      escrowTotal: bigint;
      requesterAgentId: bigint;
      cfg: ModeConfig;
    },
    account: Address
  ) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry,
      abi: MarketRegistryABI,
      functionName: 'createMarketWithMode',
      args: [
        args.metadataURI, args.scopeHash, args.tierAmounts, args.minPRep, args.maxApplicants,
        args.ghostDeadline, args.escrowTotal, args.requesterAgentId,
        {
          mode: args.cfg.mode,
          requiredProofs: args.cfg.requiredProofs,
          stakeRequired: args.cfg.stakeRequired,
          flagWindow: args.cfg.flagWindow,
        },
      ],
      account,
    });
    return this.send(request);
  }

  /** Pay the reveal fee R to unlock an applicant's submission (advances them to tier 1; the
   *  applicant's stake is now HELD behind the flag window — P6). Requester only. */
  async reveal(marketId: bigint, participant: Address, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'reveal', args: [marketId, participant], account,
    });
    return this.send(request);
  }

  /** Permissionless: once the flag window elapses unflagged, return the held reveal stake to the
   *  applicant (P6 default-resolve). */
  async settleRevealStake(marketId: bigint, participant: Address, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'settleRevealStake', args: [marketId, participant], account,
    });
    return this.send(request);
  }

  // ── Mode B: Direct Job + milestones (P3) ────────────────

  async createDirectJob(
    args: {
      worker: Address;
      workerAgentId: bigint;
      requesterAgentId: bigint;
      metadataURI: string;
      scopeHash: `0x${string}`;
      milestoneAmounts: bigint[];
      reviewWindow: bigint;
    },
    account: Address
  ) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'createDirectJob',
      args: [
        args.worker, args.workerAgentId, args.requesterAgentId, args.metadataURI,
        args.scopeHash, args.milestoneAmounts, args.reviewWindow,
      ],
      account,
    });
    return this.send(request);
  }

  async submitMilestone(marketId: bigint, index: bigint, deliverableHash: `0x${string}`, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'submitMilestone', args: [marketId, index, deliverableHash], account,
    });
    return this.send(request);
  }

  async acceptMilestone(marketId: bigint, index: bigint, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'acceptMilestone', args: [marketId, index], account,
    });
    return this.send(request);
  }

  async autoReleaseMilestone(marketId: bigint, index: bigint, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'autoReleaseMilestone', args: [marketId, index], account,
    });
    return this.send(request);
  }

  async cancelDirectJob(marketId: bigint, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'cancelDirectJob', args: [marketId], account,
    });
    return this.send(request);
  }

  async getDirectJobMilestones(marketId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'getDirectJobMilestones', args: [marketId],
    });
  }

  // ── Mode Bounty: open submissions, parallel winners (P4) ─

  async createBounty(
    args: {
      requesterAgentId: bigint;
      metadataURI: string;
      scopeHash: `0x${string}`;
      requiredProofs: bigint;
      defaultAward: bigint;
      reviewWindow: bigint;
      pool: bigint;
    },
    account: Address
  ) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'createBounty',
      args: [
        args.requesterAgentId, args.metadataURI, args.scopeHash, args.requiredProofs,
        args.defaultAward, args.reviewWindow, args.pool,
      ],
      account,
    });
    return this.send(request);
  }

  async submitFinding(marketId: bigint, submitterAgentId: bigint, findingHash: `0x${string}`, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'submitFinding', args: [marketId, submitterAgentId, findingHash], account,
    });
    return this.send(request);
  }

  async acceptFinding(marketId: bigint, index: bigint, award: bigint, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'acceptFinding', args: [marketId, index, award], account,
    });
    return this.send(request);
  }

  async rejectFinding(marketId: bigint, index: bigint, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'rejectFinding', args: [marketId, index], account,
    });
    return this.send(request);
  }

  async autoEscalateFinding(marketId: bigint, index: bigint, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'autoEscalateFinding', args: [marketId, index], account,
    });
    return this.send(request);
  }

  async closeBounty(marketId: bigint, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'closeBounty', args: [marketId], account,
    });
    return this.send(request);
  }

  async getBountyFindings(marketId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.marketRegistry, abi: MarketRegistryABI,
      functionName: 'getBountyFindings', args: [marketId],
    });
  }

  // ── Adjudication ladder: DisputeResolver (P5/P6) ────────
  // The staked-jury rung. Bonds are in the bond token (USDC) — approve the DisputeResolver for the
  // bond before openFindingDispute / openStakeDispute / counter.

  /** Submitter contests a REJECTED bounty finding. Flips it to Disputed; requester then counters. */
  async openFindingDispute(marketId: bigint, findingIndex: bigint, bond: bigint, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.disputeResolver, abi: DisputeResolverABI,
      functionName: 'openFindingDispute', args: [marketId, findingIndex, bond], account,
    });
    return this.send(request);
  }

  /** Requester flags a revealed applicant's HELD stake as bait-and-switch (opens + flags, P6).
   *  Reverts if the subject is disabled or the flag window has elapsed. */
  async openStakeDispute(marketId: bigint, participant: Address, bond: bigint, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.disputeResolver, abi: DisputeResolverABI,
      functionName: 'openStakeDispute', args: [marketId, participant, bond], account,
    });
    return this.send(request);
  }

  /** The defending side posts the matching counter bond, opening the voting window. */
  async counterDispute(disputeId: bigint, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.disputeResolver, abi: DisputeResolverABI,
      functionName: 'counter', args: [disputeId], account,
    });
    return this.send(request);
  }

  /** Panel juror votes. `forOpener` sides with the opener (finding valid / slash sustained). */
  async voteDispute(disputeId: bigint, forOpener: boolean, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.disputeResolver, abi: DisputeResolverABI,
      functionName: 'vote', args: [disputeId, forOpener], account,
    });
    return this.send(request);
  }

  /** Tally + settle after the voting window. Callable by anyone. */
  async resolveDispute(disputeId: bigint, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.disputeResolver, abi: DisputeResolverABI,
      functionName: 'resolve', args: [disputeId], account,
    });
    return this.send(request);
  }

  /** A winning-side juror claims their flat share of the loser's bond (pull-based). */
  async claimJurorReward(disputeId: bigint, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.disputeResolver, abi: DisputeResolverABI,
      functionName: 'claimJurorReward', args: [disputeId], account,
    });
    return this.send(request);
  }

  /** Authorized oracle records the rung-1 advisory hint (non-binding). */
  async recordAgentHint(disputeId: bigint, hint: `0x${string}`, account: Address) {
    if (!this.walletClient) throw new Error('Wallet not connected');
    const { request } = await this.publicClient.simulateContract({
      address: this.contracts.disputeResolver, abi: DisputeResolverABI,
      functionName: 'recordAgentHint', args: [disputeId, hint], account,
    });
    return this.send(request);
  }

  async getDispute(disputeId: bigint) {
    return this.publicClient.readContract({
      address: this.contracts.disputeResolver, abi: DisputeResolverABI,
      functionName: 'getDispute', args: [disputeId],
    });
  }

  async disputeCount() {
    return this.publicClient.readContract({
      address: this.contracts.disputeResolver, abi: DisputeResolverABI,
      functionName: 'disputeCount',
    }) as Promise<bigint>;
  }

  /** Whether `addr` is an appointed panel juror. */
  async isJuror(addr: Address) {
    return this.publicClient.readContract({
      address: this.contracts.disputeResolver, abi: DisputeResolverABI,
      functionName: 'jurors', args: [addr],
    }) as Promise<boolean>;
  }

  /** Dispute panel config: min bond, voting period (s), and whether Mode-A stake disputes are on. */
  async disputeConfig() {
    const [minBond, votingPeriod, modeAStakeEnabled, jurorCount] = await Promise.all([
      this.publicClient.readContract({ address: this.contracts.disputeResolver, abi: DisputeResolverABI, functionName: 'minBond' }) as Promise<bigint>,
      this.publicClient.readContract({ address: this.contracts.disputeResolver, abi: DisputeResolverABI, functionName: 'votingPeriod' }) as Promise<bigint>,
      this.publicClient.readContract({ address: this.contracts.disputeResolver, abi: DisputeResolverABI, functionName: 'modeAStakeEnabled' }) as Promise<boolean>,
      this.publicClient.readContract({ address: this.contracts.disputeResolver, abi: DisputeResolverABI, functionName: 'jurorCount' }) as Promise<bigint>,
    ]);
    return { minBond, votingPeriod, modeAStakeEnabled, jurorCount };
  }
}
