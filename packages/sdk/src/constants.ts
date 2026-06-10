import { Address } from '@echo/types';

// ═══════════════════════════════════════════════════════════
// Arc Testnet deployed contract addresses
// Deployed: 2026-06-07 | Chain ID: 5042002
// ═══════════════════════════════════════════════════════════

// AgenticCommerce: Arc's canonical instance is admin-gated by Circle, so EchoHook can't be
// whitelisted there without them. For testnet validation we run Echo's own self-hosted
// instance (Path C — src/arc/AgenticCommerce.sol) and self-whitelist the hook. Set
// ARC_AGENTIC_COMMERCE to that proxy address to target it; defaults to canonical otherwise.
// Switch back to canonical (unset the env / restore the literal) once Circle whitelists Echo.
const CANONICAL_AGENTIC_COMMERCE =
  '0x0747EEf0706327138c69792bF28Cd525089e4583' as Address;
// Read via globalThis so this is safe in the browser (no `process`) and clean under tsc.
const AGENTIC_COMMERCE = (((globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env?.ARC_AGENTIC_COMMERCE) || CANONICAL_AGENTIC_COMMERCE) as Address;

export const CONTRACTS = {
  arcTestnet: {
    // Arc Native Standards (pre-deployed; agenticCommerce overridable via ARC_AGENTIC_COMMERCE)
    agenticCommerce: AGENTIC_COMMERCE,
    canonicalAgenticCommerce: CANONICAL_AGENTIC_COMMERCE,
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' as Address,
    reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713' as Address,
    validationRegistry: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272' as Address,
    usdc: '0x3600000000000000000000000000000000000000' as Address,

    // Echo Protocol contracts (UUPS proxies — interact with these)
    marketRegistry: '0x6ce0899056cb7e36524703289da66a8ed0e333dc' as Address,
    echoHook: '0x6333b42426e5684bdb696be2ff302ad5cfc84866' as Address,
    participationReceipt: '0xb767dff0813840fcf1d58cf79b161ba198967da0' as Address,
    attributionRegistry: '0x8845b933C996EC7d15E6FC35276e9D360e9507dD' as Address,
    attributionPayout: '0x3240a70f4688afe0AB6294585982324FF4CbACD3' as Address,
  },
} as const;

// Implementations (for upgrade transactions only)
export const IMPLEMENTATIONS = {
  arcTestnet: {
    marketRegistry: '0xad3CC8Da62Fb017A987635562AF86da1E83bC52A' as Address,
    echoHook: '0x572355F2A3037352681f9D4f475E97b66aCe900B' as Address,
    participationReceipt: '0x2bA8ED70dEe63351d2fF739E36182972e9a695C4' as Address,
  },
} as const;

// GraphQL API endpoint
export const API = {
  indexer: process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4000/graphql',
} as const;

// Default tier amounts (in USDC base units = cents, 6 decimals)
export const DEFAULT_TIERS = {
  hiring: [5_000_000, 50_000_000, 250_000_000, 1_000_000_000], // $5, $50, $250, $1000
  rfp: [2_000_000_000, 5_000_000_000, 20_000_000_000, 50_000_000_000], // $2K, $5K, $20K, $50K
} as const;
