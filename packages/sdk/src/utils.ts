/**
 * Echo Protocol SDK utilities
 */

// USDC on Arc has 6 decimals
export const USDC_DECIMALS = 6;

// Convert dollars (as number) to USDC base units (bigint)
export function toUSDC(dollars: number): bigint {
  return BigInt(Math.round(dollars * 10 ** USDC_DECIMALS));
}

// Convert USDC base units (bigint) to dollars (number)
export function fromUSDC(amount: bigint): number {
  return Number(amount) / 10 ** USDC_DECIMALS;
}

// Format USDC for display: 5000000 -> "$5.00"
export function formatUSDC(amount: bigint | number): string {
  const val = typeof amount === 'bigint' ? fromUSDC(amount) : amount;
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Shorten Ethereum address: 0x6ce0...e333dc
export function shortenAddress(addr: string, chars = 4): string {
  if (addr.length <= 2 + chars * 2) return addr;
  return `${addr.slice(0, 2 + chars)}...${addr.slice(-chars)}`;
}

// Generate a submission hash from a string (for applyToMarket)
export function hashSubmission(input: string): `0x${string}` {
  // In production, use keccak256 from viem with the actual submission data
  // This is a placeholder that produces a valid 32-byte hex string
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  return `0x${Array.from(data)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .padEnd(64, '0')
    .slice(0, 64)}` as `0x${string}`;
}

// Wait for transaction receipt
export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
