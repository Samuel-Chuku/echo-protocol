import { Address } from '@echo/types';

// Arc Testnet deployed contract addresses
// TODO: VERIFY THESE LIVE BEFORE USE
export const CONTRACTS = {
  arcTestnet: {
    // Arc Native Standards (Circle deployed)
    agenticCommerce: '0x0747EEf0706327138c69792bF28Cd525089e4583' as Address,
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' as Address,
    reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713' as Address,
    validationRegistry: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272' as Address,
    usdc: '0x3600000000000000000000000000000000000000' as Address, // VERIFY

    // Echo Contracts (fill after deployment)
    marketRegistry: '' as Address,
    echoHook: '' as Address,
    participationReceipt: '' as Address,
  },
} as const;

// GraphQL API endpoint
export const API = {
  indexer: process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4000/graphql',
} as const;

// Default tier amounts (in USDC base units / cents)
export const DEFAULT_TIERS = {
  hiring: [500, 5000, 25000, 100000], // $5, $50, $250, $1000
  rfp: [200000, 500000, 2000000, 5000000], // $2K, $5K, $20K, $50K
} as const;
