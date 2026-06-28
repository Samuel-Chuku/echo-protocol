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
    // P1 (mode + entry foundations) — Echo's pluggable genesis filter (sibling UUPS proxy).
    validationGate: '0x5590Fa35b3E75A9cC3b12Edb7858936Aca383E32' as Address,
    // P5 (adjudication ladder) — staked-jury rung (sibling UUPS proxy).
    disputeResolver: '0x8d04351F57C4BF2089B2F1E53dBe569e3AeF8EC8' as Address,
  },
} as const;

// Delegatecall libraries linked into the MarketRegistry impl (size relief, spec §8). Plain
// libraries (not proxies); their addresses are baked into the linked impl bytecode and only matter
// for verification / relinking a future impl. Re-deployed (CREATE2) at P6 — EchoBounty/EchoDirectJob
// changed (settle calls now carry the silent flag) and EchoReveal is new (reveal stake-hold).
// Broadcast 2026-06-13.
export const LIBRARIES = {
  arcTestnet: {
    echoBounty: '0xCA19CA3f2372ceF016Bb6730aB273B31FB927635' as Address,
    echoDirectJob: '0x79D92167E501d56CD79242b64337e86D77e5D443' as Address,
    echoReveal: '0xa57EDf77dbB86918225AaD84230BD0380Ff7ce78' as Address,
  },
} as const;

// Implementations (for upgrade transactions only). Proxies in CONTRACTS are unchanged.
// Latest EchoHook + MarketRegistry impls: closeMarket guard + Final-tier Request-Revision
// (2026-06-28, UpgradeRevisionAndCloseGuard). EchoHook reopens/extends the revision window;
// MarketRegistry.closeMarket reverts FinalJobStillSubmitted while a Final job is Submitted. The
// AgenticCommerce test-instance proxy (0x1211eDC2…bF16) was also upgraded for requestRevision — its
// impl 0x77731f21ee263ab367BD884fdF3A2a9f7D0C978D isn't tracked here (proxy unchanged, not in CONTRACTS
// upgrade set). Prior EchoHook: ghost status-branch (2026-06-24).
export const IMPLEMENTATIONS = {
  arcTestnet: {
    marketRegistry: '0xB4137204B5D8b2556402fe127761cC8D762aC5e0' as Address,
    echoHook: '0xa74532114E7734971ddB2980Bf94f1C3B58fdB38' as Address,
    participationReceipt: '0x2bA8ED70dEe63351d2fF739E36182972e9a695C4' as Address,
    validationGate: '0x5590Fa35b3E75A9cC3b12Edb7858936Aca383E32' as Address,
    disputeResolver: '0xF8F05Dc0Ae083754721419dA91C3A4FAD77d7061' as Address,
  },
} as const;

// GraphQL API endpoint. Read env without depending on @types/node (isomorphic SDK).
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
export const API = {
  indexer: env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4000/graphql',
} as const;

// Default tier amounts (in USDC base units = cents, 6 decimals)
export const DEFAULT_TIERS = {
  hiring: [5_000_000, 50_000_000, 250_000_000, 1_000_000_000], // $5, $50, $250, $1000
  rfp: [2_000_000_000, 5_000_000_000, 20_000_000_000, 50_000_000_000], // $2K, $5K, $20K, $50K
} as const;
