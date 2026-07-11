import { config } from '../config.js';

/**
 * Circle Developer-Controlled Wallet (DCW) wrapper for the autonomous agent (#4). The DCW is the
 * market's requester on Arc, so it can call the `onlyRequester` functions (reveal / gradeShortlist).
 * Circle signs + broadcasts server-side via `createContractExecutionTransaction` — no private key in
 * the indexer. Dynamic-imported (repo convention for Circle SDKs) so the module loads only when the
 * agent is enabled and the package is installed. ARC-TESTNET is a supported Circle blockchain.
 */

let clientPromise: Promise<any> | null = null;

async function getClient(): Promise<any> {
  if (!config.circleApiKey || !config.circleEntitySecret) {
    throw new Error('Circle keys missing (CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET)');
  }
  if (!clientPromise) {
    // Variable specifier (not a string literal) so tsc doesn't statically resolve the module — the
    // package is a runtime-only dep that may not be installed when the agent is disabled.
    const pkg = '@circle-fin/developer-controlled-wallets';
    clientPromise = import(/* @vite-ignore */ pkg).then((m: any) =>
      m.initiateDeveloperControlledWalletsClient({
        apiKey: config.circleApiKey,
        entitySecret: config.circleEntitySecret,
      }),
    );
  }
  return clientPromise;
}

const BLOCKCHAIN = 'ARC-TESTNET';
const MEDIUM_FEE = { type: 'level' as const, config: { feeLevel: 'MEDIUM' as const } };

/** Ensure a wallet set exists (reuse config.circleWalletSetId, else create one). Returns its id. */
async function ensureWalletSet(): Promise<string> {
  if (config.circleWalletSetId) return config.circleWalletSetId;
  const client = await getClient();
  const res = await client.createWalletSet({ name: 'echo-agent-wallets' });
  const id = res.data?.walletSet?.id;
  if (!id) throw new Error('Circle createWalletSet returned no id');
  return id;
}

/** Provision a new EOA DCW on Arc for a requester. Returns the Circle walletId + on-chain address. */
export async function provisionAgentWallet(refId?: string): Promise<{ walletId: string; address: `0x${string}`; walletSetId: string }> {
  const client = await getClient();
  const walletSetId = await ensureWalletSet();
  const res = await client.createWallets({
    blockchains: [BLOCKCHAIN],
    accountType: 'EOA',
    count: 1,
    walletSetId,
    ...(refId ? { metadata: [{ refId }] } : {}),
  });
  const w = res.data?.wallets?.[0];
  if (!w?.id || !w?.address) throw new Error('Circle createWallets returned no wallet');
  return { walletId: w.id, address: w.address as `0x${string}`, walletSetId };
}

/** USDC balance (human units string) of a DCW, for funding checks. */
export async function walletUsdcBalance(walletId: string): Promise<string> {
  const client = await getClient();
  const res = await client.getWalletTokenBalance({ id: walletId });
  const bal = (res.data?.tokenBalances ?? []).find(
    (b: any) => (b.token?.symbol ?? '').toUpperCase().includes('USDC'),
  );
  return bal?.amount ?? '0';
}

/** Execute a contract function via ABI signature (simple args only: uint/address as strings). */
async function execAbi(walletId: string, contractAddress: string, sig: string, params: (string | number | boolean)[]): Promise<string> {
  const client = await getClient();
  const res = await client.createContractExecutionTransaction({
    walletId,
    contractAddress,
    abiFunctionSignature: sig,
    abiParameters: params,
    fee: MEDIUM_FEE,
  });
  const id = res.data?.id;
  if (!id) throw new Error(`Circle createContractExecutionTransaction (${sig}) returned no id`);
  return id;
}

/** Execute with raw pre-encoded calldata (for complex structs like createMarketWithMode). */
export async function execCallData(walletId: string, contractAddress: string, callData: `0x${string}`): Promise<string> {
  const client = await getClient();
  const res = await client.createContractExecutionTransaction({ walletId, contractAddress, callData, fee: MEDIUM_FEE });
  const id = res.data?.id;
  if (!id) throw new Error('Circle createContractExecutionTransaction (callData) returned no id');
  return id;
}

/** Poll a Circle transaction to terminal state. Returns the on-chain txHash on success, throws on fail. */
export async function waitForTx(txId: string, timeoutMs = 120_000): Promise<`0x${string}`> {
  const client = await getClient();
  const deadline = Date.now() + timeoutMs;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (;;) {
    const res = await client.getTransaction({ id: txId });
    const tx = res.data?.transaction ?? res.data;
    const state: string = tx?.state ?? 'INITIATED';
    if (state === 'COMPLETE' || state === 'CONFIRMED') return (tx?.txHash ?? '0x') as `0x${string}`;
    if (state === 'FAILED' || state === 'DENIED' || state === 'CANCELLED') {
      throw new Error(`Circle tx ${txId} ${state}: ${tx?.errorReason ?? tx?.errorDetails ?? 'no detail'}`);
    }
    if (Date.now() > deadline) throw new Error(`Circle tx ${txId} timed out in state ${state}`);
    await sleep(3000);
  }
}

// ── Echo-specific execs (contract addresses from config) ──
const C = config.contracts;

/** reveal(marketId, participant) — pays the reveal fee from escrow, advances applicant to tier 1. */
export function execReveal(walletId: string, marketId: number, participant: string): Promise<string> {
  return execAbi(walletId, C.marketRegistry, 'reveal(uint256,address)', [String(marketId), participant]);
}

/** gradeShortlist(marketId, participant) — advances a revealed applicant to Shortlist (tier 2). */
export function execGradeShortlist(walletId: string, marketId: number, participant: string): Promise<string> {
  return execAbi(walletId, C.marketRegistry, 'gradeShortlist(uint256,address)', [String(marketId), participant]);
}

/** approve(spender, amount) on USDC — lets the market pull escrow when the DCW creates a market. */
export function execApproveUsdc(walletId: string, spender: string, amount: string): Promise<string> {
  return execAbi(walletId, C.usdc, 'approve(address,uint256)', [spender, amount]);
}

export const agentContracts = C;
