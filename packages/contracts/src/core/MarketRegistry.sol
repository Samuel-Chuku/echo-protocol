// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAgenticCommerce} from "../interfaces/IERC8183.sol";
import {IIdentityRegistry} from "../interfaces/IERC8004.sol";
import {IValidationGate} from "../interfaces/IValidationGate.sol";
import {EchoHook} from "./EchoHook.sol";
import {ParticipationReceipt} from "./ParticipationReceipt.sol";
import {AttributionRegistry} from "./AttributionRegistry.sol";
import {EchoBounty} from "./EchoBounty.sol";
import {EchoDirectJob} from "./EchoDirectJob.sol";
import {EchoReveal} from "./EchoReveal.sol";
import {IDisputeAdjudicable} from "../interfaces/IDisputeAdjudicable.sol";

/**
 * @title MarketRegistry
 * @notice Upgradeable Echo market factory. Lets requesters create markets, fund escrow pools,
 *         and spawns ERC-8183 jobs per tier transition for each participant.
 * @dev Uses UUPS proxy pattern for upgradeability.
 */
contract MarketRegistry is Initializable, OwnableUpgradeable, UUPSUpgradeable, IDisputeAdjudicable {
    using SafeERC20 for IERC20;

    /// @notice Selectable market shape (spec §2). P1 builds the Open Market lifecycle; Direct Job
    ///         and Bounty are stored-but-guarded until their lifecycles land (P3 / P4).
    enum Mode {
        OpenMarket, // A — multi-stage funnel (the existing tiered flow)
        DirectJob,  // B — two known parties + milestones (P3)
        Bounty      // open submissions, parallel winners (P4)
    }

    /// @notice Mode + entry configuration for createMarketWithMode (P1 mode/entry params + the P6
    ///         reveal flag window), bundled into one calldata struct so the external selector stays
    ///         under the non-IR ABI-decoder stack limit (via_ir stays OFF — spec §8 size relief).
    struct ModeConfig {
        Mode mode;
        uint256 requiredProofs;  // requester's accepted-proof bitmask (OR-ed with PROOF_IDENTITY)
        uint256 stakeRequired;   // per-applicant returnable stake S (anti-bait bond; 0 = none)
        uint256 flagWindow;      // reveal flag-window seconds (must be > 0 when stakeRequired > 0)
    }

    /// @notice The genesis proof every applicant must hold (control of the ERC-8004 NFT). Mirrors
    ///         ValidationGate.PROOF_IDENTITY; the default accepted-proof set for legacy markets.
    uint256 public constant PROOF_IDENTITY = 1 << 0;

    /// @notice Min-reveal floor (spec §6): a reveal market must fund — and before closing, actually
    ///         pay — at least this many reveals (capped by applicant count), so a requester cannot
    ///         harvest applications and refund without paying anyone.
    uint256 public constant MIN_REVEALS = 5;

    struct Market {
        uint256 id;
        address requester;
        bytes32 scopeHash;
        string metadataURI;
        uint256[4] tierAmounts;
        uint256 minPRep;
        uint256 maxApplicants;
        uint256 ghostDeadline;
        uint256 escrowTotal;
        uint256 escrowSpent;
        uint256 applicantCount;
        bool active;
        bool closed;
        // ERC-8004 identity of the requester (Arc has no address→agentId reverse lookup,
        // so the requester supplies their own agentId at createMarket and we verify+store it).
        uint256 requesterAgentId;
    }

    /// @notice Mode B types (MilestoneStatus / DirectJob / Milestone) moved to the EchoDirectJob
    ///         library in P5 (size relief, spec §8). Referenced here and in tests as
    ///         EchoDirectJob.*. The Mode B STORAGE mappings still live in this contract (slots
    ///         17/18, below) — only the lifecycle code + type defs relocated; layout is unchanged.

    /// @notice Mode Bounty types (FindingStatus / Bounty / Finding) moved to the EchoBounty
    ///         library in P5 (size relief, spec §8). Referenced here and in tests as EchoBounty.*.
    ///         The bounty STORAGE mappings still live in this contract (slots 19–21, below) —
    ///         only the lifecycle code + type defs relocated; storage layout is unchanged.

    struct Application {
        uint256 marketId;
        address participant;
        bytes32 submissionHash;
        uint256 receiptTokenId;
        uint8 tierReached;
        uint256[] tierJobIds;
        uint48 appliedAt;
        bool withdrawn;
        // ERC-8004 identity of the applicant, supplied + verified at applyToMarket.
        uint256 agentId;
    }

    /// @notice Mode-A reveal stake lifecycle types (RevealStatus / RevealHold) live in the EchoReveal
    ///         delegatecall library (P6 size relief, spec §8). Referenced here and in tests as
    ///         EchoReveal.*. The `revealHolds` STORAGE mapping still lives in this contract (slot 24,
    ///         below) — only the type defs + lifecycle code relocated; layout is unchanged.

    IERC20 public usdc;
    IAgenticCommerce public agenticCommerce;
    IIdentityRegistry public identityRegistry;
    EchoHook public echoHook;
    ParticipationReceipt public participationReceipt;

    uint256 public marketCount;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => Application[]) public marketApplications;
    mapping(uint256 => mapping(address => uint256)) public participantApplicationIndex;
    mapping(address => uint256[]) public requesterMarkets;

    // Appended after the original layout (UUPS-safe): added in the attribution upgrade.
    AttributionRegistry public attributionRegistry;

    // --- Mode + entry foundations (P1), appended storage (UUPS-safe). Mode-specific data lives
    //     in NEW mappings, never as struct field-inserts (spec §8). ---
    IValidationGate public validationGate;                  // pluggable genesis filter (sibling)
    mapping(uint256 => Mode) public marketMode;             // market => selected shape
    mapping(uint256 => uint256) public marketRequiredProofs; // market => requester's accepted-proof bitmask
    mapping(uint256 => uint256) public marketStakeRequired;  // market => per-applicant returnable stake S

    // --- Mode A reveal (P2), appended storage (UUPS-safe). ---
    mapping(uint256 => uint256) public revealFee;   // market => reveal fee R (0 = not a reveal market)
    mapping(uint256 => uint256) public revealCount; // market => reveals paid so far (for the floor guard)

    // --- Mode B direct job (P3), appended storage (UUPS-safe). Shares the marketCount id space. ---
    mapping(uint256 => EchoDirectJob.DirectJob) public directJobs;
    mapping(uint256 => EchoDirectJob.Milestone[]) public directJobMilestones;

    // --- Mode Bounty (P4), appended storage (UUPS-safe). Shares the marketCount id space.
    //     Types live in EchoBounty (P5 extraction); these slots (19/20/21) are unchanged. ---
    mapping(uint256 => EchoBounty.Bounty) public bounties;
    mapping(uint256 => EchoBounty.Finding[]) public bountyFindings;
    mapping(uint256 => uint256) public bountyPendingCount; // open (Pending+Disputed) findings, for the no-reclaim guard

    // --- Adjudication ladder (P5), appended storage (UUPS-safe). Slot 22. ---
    // The staked-jury rung (spec §5). Set once; drives the adjudicated finding/stake callbacks.
    address public disputeResolver;

    // --- Mode-A reveal stake-hold (P6, spec §4/§8), appended storage (UUPS-safe). Slots 23/24. ---
    mapping(uint256 => uint256) public revealFlagWindow;                         // market => flag window seconds
    // Internal (not public): the hold lifecycle is fully observable via the Reveal* events, and the
    // struct-returning auto getter is bytecode the registry can't spare under EIP-170.
    mapping(uint256 => mapping(address => EchoReveal.RevealHold)) internal revealHolds; // market => participant => hold

    // Worker-recourse tier-job dispute state (the `tierJobDisputed` flag) lives in EchoHook, not here —
    // it owns the tier escrow the flag gates, and the registry has no EIP-170 headroom to spare. The
    // adjudication callbacks below are thin forwarders into EchoHook.

    event MarketCreated(
        uint256 indexed marketId,
        address indexed requester,
        uint256 escrowTotal,
        uint256[4] tierAmounts
    );
    event MarketFunded(uint256 indexed marketId, uint256 amount);
    event AgenticCommerceSet(address indexed agenticCommerce);
    event MarketClosed(uint256 indexed marketId, uint256 refundAmount);
    event Applied(
        uint256 indexed marketId,
        address indexed participant,
        uint256 receiptTokenId,
        bytes32 submissionHash
    );
    event TierAdvanced(
        uint256 indexed marketId,
        address indexed participant,
        uint8 fromTier,
        uint8 toTier,
        uint256 jobId
    );
    event MarketModeSet(uint256 indexed marketId, Mode mode, uint256 requiredProofs, uint256 stakeRequired);
    event StakeSlashed(uint256 indexed marketId, address indexed participant, address indexed to);
    event Revealed(uint256 indexed marketId, address indexed participant, uint256 revealFee);
    event DirectJobCreated(uint256 indexed marketId, address indexed requester, address indexed worker, uint256 total, uint256 milestoneCount);
    event MilestoneSubmitted(uint256 indexed marketId, uint256 indexed index, bytes32 deliverableHash);
    event MilestoneReleased(uint256 indexed marketId, uint256 indexed index, uint256 amount, bool autoReleased);
    event DirectJobCancelled(uint256 indexed marketId, uint256 refunded);
    event BountyCreated(uint256 indexed marketId, address indexed requester, uint256 pool, uint256 defaultAward);
    event FindingSubmitted(uint256 indexed marketId, uint256 indexed index, address indexed submitter, bytes32 findingHash);
    event FindingAccepted(uint256 indexed marketId, uint256 indexed index, uint256 award, bool autoEscalated);
    event FindingRejected(uint256 indexed marketId, uint256 indexed index);
    event BountyClosed(uint256 indexed marketId, uint256 refunded);
    event DisputeResolverSet(address indexed disputeResolver);
    // Tier-rejection dispute lifecycle is observable without dedicated registry events: the open via
    // DisputeResolver.DisputeOpened (subject 2, carries marketId) and the outcome via
    // EchoHook.DisputedTierSettled (carries marketId + workerWon). Keeping them off the registry holds
    // its runtime bytecode under the EIP-170 limit (spec §8).

    error InsufficientEscrow(uint256 provided, uint256 required);
    error MarketNotActive();
    error MarketAlreadyClosed();
    error NotRequester();
    error NotParticipant();
    error AlreadyApplied();
    error MaxApplicantsReached();
    error InvalidTierTransition(uint8 from, uint8 to);
    error NoIdentity();
    error NotAgentOwner();
    error ZeroAddress();

    error AlreadySet();
    error InvalidShare();
    error UnsupportedMode();
    error ValidationFailed();
    error NotRevealMarket();
    error RevealFloorNotMet();
    error StakeTooSmall();
    error NotDirectJob();
    error NoMilestones();
    error NotWorker();
    error JobCancelled();
    error MilestoneNotPending();
    error MilestoneNotSubmitted();
    error ReviewWindowNotElapsed();
    error BadMilestoneIndex();
    error NotBounty();
    error BountyIsClosed();
    error FindingNotPending();
    error BadFindingIndex();
    error AwardBelowFloor();
    error AwardExceedsPool();
    error FindingsStillPending();
    error FindingNotRejected();
    error FindingNotDisputed();
    error NotDisputeResolver();
    error FlagWindowRequired();
    error RevealNotHeld();
    error FlagWindowNotElapsed();
    error FlagWindowElapsed();
    error RevealNotFlagged();
    error RevealStillFlagged();
    error FinalJobStillSubmitted();
    // Tier-rejection precondition reverts (NotProvider / JobNotRejected / WrongMarket / WrongTier /
    // TierJobAlreadyDisputed / TierJobNotDisputed) now originate in EchoHook. Only the close guard
    // reverts here.
    error FinalJobDisputed();

    function initialize(
        address _usdc,
        address _agenticCommerce,
        address _identityRegistry,
        address _echoHook,
        address _participationReceipt
    ) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        usdc = IERC20(_usdc);
        agenticCommerce = IAgenticCommerce(_agenticCommerce);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        if (_echoHook != address(0)) echoHook = EchoHook(_echoHook);
        if (_participationReceipt != address(0)) participationReceipt = ParticipationReceipt(_participationReceipt);
    }

    function setEchoHook(address _echoHook) external onlyOwner {
        if (address(echoHook) != address(0)) revert AlreadySet();
        if (_echoHook == address(0)) revert ZeroAddress();
        echoHook = EchoHook(_echoHook);
    }

    function setParticipationReceipt(address _participationReceipt) external onlyOwner {
        if (address(participationReceipt) != address(0)) revert AlreadySet();
        if (_participationReceipt == address(0)) revert ZeroAddress();
        participationReceipt = ParticipationReceipt(_participationReceipt);
    }

    function setAttributionRegistry(address _attributionRegistry) external onlyOwner {
        if (address(attributionRegistry) != address(0)) revert AlreadySet();
        if (_attributionRegistry == address(0)) revert ZeroAddress();
        attributionRegistry = AttributionRegistry(_attributionRegistry);
    }

    /// @notice Wire the pluggable genesis filter. Until set, applyToMarket falls back to the inline
    ///         identity-ownership check (legacy behavior), so this is additive and migration-free.
    function setValidationGate(address _validationGate) external onlyOwner {
        if (address(validationGate) != address(0)) revert AlreadySet();
        if (_validationGate == address(0)) revert ZeroAddress();
        validationGate = IValidationGate(_validationGate);
    }

    /// @notice Repoint the AgenticCommerce instance jobs are created on. Lets Echo run
    ///         against a self-hosted test instance now and switch to Arc's canonical
    ///         AgenticCommerce later (once Circle whitelists EchoHook) with no redeploy.
    ///         Must match the instance EchoHook trusts (see EchoHook.setAgenticCommerce).
    function setAgenticCommerce(address _agenticCommerce) external onlyOwner {
        if (_agenticCommerce == address(0)) revert ZeroAddress();
        agenticCommerce = IAgenticCommerce(_agenticCommerce);
        emit AgenticCommerceSet(_agenticCommerce);
    }

    /// @notice Optional: a requester funds a pool that rewards the introducer of any applicant
    ///         who advances a tier in this market. Drawn from the requester's own escrow, not
    ///         from Echo's fee — so it is bounded only by the funded amount.
    function fundAttributionPool(uint256 marketId, uint256 amount, uint16 introducerShareBps) external {
        Market storage m = markets[marketId];
        if (msg.sender != m.requester) revert NotRequester();
        if (m.closed) revert MarketAlreadyClosed();
        if (introducerShareBps > 10_000) revert InvalidShare();

        usdc.safeTransferFrom(msg.sender, address(echoHook), amount);
        echoHook.fundPool(marketId, amount, introducerShareBps);
    }

    /// @notice Create an Open Market (Mode A) with the legacy defaults: identity-only entry, no
    ///         stake. Unchanged 8-arg signature — preserves the existing SDK + tests.
    function createMarket(
        string calldata metadataURI,
        bytes32 scopeHash,
        uint256[4] calldata tierAmounts,
        uint256 minPRep,
        uint256 maxApplicants,
        uint256 ghostDeadline,
        uint256 escrowTotal,
        uint256 requesterAgentId
    ) external returns (uint256 marketId) {
        return _create(
            metadataURI, scopeHash, tierAmounts, minPRep, maxApplicants, ghostDeadline,
            escrowTotal, requesterAgentId, Mode.OpenMarket, PROOF_IDENTITY, 0
        );
    }

    /// @notice Create a market with an explicit mode + genesis filter (spec §2/§3/§4). Mode/entry
    ///         params are bundled in `cfg` (ModeConfig) for non-IR ABI-decoder stack relief.
    /// @param cfg Mode shape, accepted-proof bitmask, returnable stake S, and reveal flag window.
    ///        P1 supports Open Market only; Direct Job / Bounty revert UnsupportedMode until their
    ///        lifecycles land (P3 / P4) — no escrow into a mode with no exit path. `cfg.flagWindow`
    ///        must be > 0 when `cfg.stakeRequired > 0` (the held reveal stake needs a flag window).
    function createMarketWithMode(
        string calldata metadataURI,
        bytes32 scopeHash,
        uint256[4] calldata tierAmounts,
        uint256 minPRep,
        uint256 maxApplicants,
        uint256 ghostDeadline,
        uint256 escrowTotal,
        uint256 requesterAgentId,
        ModeConfig calldata cfg
    ) external returns (uint256 marketId) {
        if (cfg.mode != Mode.OpenMarket) revert UnsupportedMode();

        // Mode A reveal-market bindings (spec §4/§6). Validated in a helper to keep this frame
        // shallow — the external selector + the _create call sit at the non-IR stack limit.
        _validateRevealParams(tierAmounts[0], escrowTotal, cfg.stakeRequired, cfg.flagWindow);

        marketId = _create(
            metadataURI, scopeHash, tierAmounts, minPRep, maxApplicants, ghostDeadline,
            escrowTotal, requesterAgentId, cfg.mode, cfg.requiredProofs | PROOF_IDENTITY, cfg.stakeRequired
        );
        revealFee[marketId] = tierAmounts[0];
        revealFlagWindow[marketId] = cfg.flagWindow;
    }

    /// @dev Reveal-market create-time bindings. `fee` is the reveal fee R = tierAmounts[0].
    function _validateRevealParams(uint256 fee, uint256 escrowTotal, uint256 stakeRequired, uint256 flagWindow)
        internal
        pure
    {
        // Min-reveal escrow binding (spec §6): fund at least MIN_REVEALS reveals.
        if (escrowTotal < fee * MIN_REVEALS) revert InsufficientEscrow(escrowTotal, fee * MIN_REVEALS);
        // Stake sizing S >= R (spec §4): a bad reveal at least refunds what the requester paid to look.
        if (stakeRequired > 0 && stakeRequired < fee) revert StakeTooSmall();
        // A held stake needs a window the requester can flag within (P6, spec §4).
        if (stakeRequired > 0 && flagWindow == 0) revert FlagWindowRequired();
    }

    function _create(
        string calldata metadataURI,
        bytes32 scopeHash,
        uint256[4] calldata tierAmounts,
        uint256 minPRep,
        uint256 maxApplicants,
        uint256 ghostDeadline,
        uint256 escrowTotal,
        uint256 requesterAgentId,
        Mode mode,
        uint256 requiredProofs,
        uint256 stakeRequired
    ) internal returns (uint256 marketId) {
        uint256 minRequired = _calculateMinEscrow(tierAmounts, maxApplicants, ghostDeadline);
        if (escrowTotal < minRequired) revert InsufficientEscrow(escrowTotal, minRequired);

        // Requester must control the ERC-8004 identity they claim (it receives R-Rep).
        if (!identityRegistry.isAuthorizedOrOwner(msg.sender, requesterAgentId)) revert NotAgentOwner();

        marketId = ++marketCount;

        markets[marketId] = Market({
            id: marketId,
            requester: msg.sender,
            scopeHash: scopeHash,
            metadataURI: metadataURI,
            tierAmounts: tierAmounts,
            minPRep: minPRep,
            maxApplicants: maxApplicants,
            ghostDeadline: ghostDeadline,
            escrowTotal: escrowTotal,
            escrowSpent: 0,
            applicantCount: 0,
            active: true,
            closed: false,
            requesterAgentId: requesterAgentId
        });

        marketMode[marketId] = mode;
        marketRequiredProofs[marketId] = requiredProofs;
        marketStakeRequired[marketId] = stakeRequired;

        requesterMarkets[msg.sender].push(marketId);

        usdc.safeTransferFrom(msg.sender, address(echoHook), escrowTotal);
        echoHook.fundEscrow(marketId, escrowTotal);
        echoHook.setTierAmounts(marketId, tierAmounts);

        emit MarketCreated(marketId, msg.sender, escrowTotal, tierAmounts);
        emit MarketModeSet(marketId, mode, requiredProofs, stakeRequired);
    }

    function applyToMarket(uint256 marketId, uint256 agentId, bytes32 submissionHash) external returns (uint256 receiptTokenId) {
        Market storage m = markets[marketId];
        if (!m.active) revert MarketNotActive();
        if (m.closed) revert MarketAlreadyClosed();
        if (m.applicantCount >= m.maxApplicants) revert MaxApplicantsReached();
        if (participantApplicationIndex[marketId][msg.sender] != 0) revert AlreadyApplied();

        // Genesis filter (spec §3): validation, not reputation. When a gate is wired it is
        // authoritative (identity-ownership + the requester's accepted-proof set); otherwise fall
        // back to the inline identity check so legacy markets behave exactly as before.
        if (address(validationGate) != address(0)) {
            if (!validationGate.validate(agentId, msg.sender, marketRequiredProofs[marketId])) {
                revert ValidationFailed();
            }
        } else if (!identityRegistry.isAuthorizedOrOwner(msg.sender, agentId)) {
            revert NotAgentOwner();
        }

        // Returnable anti-bait stake (spec §4): never a fee — refunded on good-faith resolution,
        // forfeited only on a sustained bait-flag / post-engagement no-show (adjudicated later).
        uint256 stake = marketStakeRequired[marketId];
        if (stake > 0) {
            usdc.safeTransferFrom(msg.sender, address(echoHook), stake);
            echoHook.lockStake(marketId, msg.sender, stake);
        }

        receiptTokenId = participationReceipt.mint(msg.sender, marketId, submissionHash);

        Application storage app = marketApplications[marketId].push();
        app.marketId = marketId;
        app.participant = msg.sender;
        app.submissionHash = submissionHash;
        app.receiptTokenId = receiptTokenId;
        app.tierReached = 0;
        app.appliedAt = uint48(block.timestamp);
        app.agentId = agentId;

        participantApplicationIndex[marketId][msg.sender] = marketApplications[marketId].length;
        m.applicantCount++;

        emit Applied(marketId, msg.sender, receiptTokenId, submissionHash);
    }

    /// @notice Mode A entry payment (spec §2.1). Reframes the first tier as a REVEAL: the requester
    ///         pays the reveal fee R to unlock one applicant's full application, and in the SAME tx
    ///         R is paid out — atomic exchange, so looking IS the payment trigger and
    ///         harvest-before-pay is structurally impossible. The applicant's anti-bait stake is now
    ///         HELD (P6) behind a flag window instead of refunded here: if the requester finds the
    ///         revealed work was a bait-and-switch they flag it (open a bonded dispute) within the
    ///         window; otherwise the stake auto-returns via settleRevealStake. Content delivery is
    ///         app-mediated off-chain (to this requester only); the money is on-chain and trustless.
    ///         Advances the applicant to tier 1, sitting below the existing shortlist/final tiers.
    function reveal(uint256 marketId, address participant) external {
        Market storage m = markets[marketId];
        if (msg.sender != m.requester) revert NotRequester();
        if (m.closed) revert MarketAlreadyClosed();
        if (revealFee[marketId] == 0) revert NotRevealMarket();

        Application storage app = _getApplication(marketId, participant);
        if (app.tierReached != 0) revert InvalidTierTransition(app.tierReached, 1);

        uint256 fee = revealFee[marketId];

        // Pay the reveal fee (net of protocol fee, with the AR overlay earning on the reveal). The
        // stake is NOT refunded here anymore — it is held behind the flag window (P6).
        echoHook.settleReveal(marketId, participant, app.agentId, m.requesterAgentId, fee);

        // Open the flag window only when there is a stake to hold; stake-free reveal markets keep the
        // legacy behavior (nothing held, nothing to settle later). The hold lifecycle then runs
        // through the EchoReveal library (settleRevealStake / markRevealFlagged / resolveStakeDispute).
        if (marketStakeRequired[marketId] > 0) {
            revealHolds[marketId][participant] =
                EchoReveal.RevealHold({revealedAt: uint64(block.timestamp), status: EchoReveal.RevealStatus.Held});
        }

        app.tierReached = 1;
        revealCount[marketId] += 1;
        participationReceipt.advanceTier(app.receiptTokenId, 1, fee);

        if (address(attributionRegistry) != address(0)) {
            attributionRegistry.recordGrade(app.agentId, msg.sender);
        }

        emit Revealed(marketId, participant, fee);
        emit TierAdvanced(marketId, participant, 0, 1, 0);
    }

    /// @notice Default-resolve a held reveal stake (P6, spec §8). Permissionless: once the flag
    ///         window elapses with no flag, anyone may return the applicant's stake — silence favors
    ///         the applicant, mirroring the auto-release / auto-escalate timeouts of the other modes.
    ///         Thin forwarder over the EchoReveal delegatecall library.
    function settleRevealStake(uint256 marketId, address participant) external {
        EchoReveal.settleRevealStake(revealHolds, revealFlagWindow, echoHook, marketId, participant);
    }

    function gradeSubstantive(uint256 marketId, address participant) external {
        Market storage m = markets[marketId];
        if (msg.sender != m.requester) revert NotRequester();
        if (m.closed) revert MarketAlreadyClosed();

        Application storage app = _getApplication(marketId, participant);
        if (app.tierReached != 0) revert InvalidTierTransition(app.tierReached, 1);

        uint256 jobId = _createTierJob(marketId, participant, EchoHook.Tier.Substantive);
        app.tierJobIds.push(jobId);
        app.tierReached = 1;

        participationReceipt.advanceTier(app.receiptTokenId, 1, m.tierAmounts[0]);

        if (address(attributionRegistry) != address(0)) {
            attributionRegistry.recordGrade(app.agentId, msg.sender);
        }

        emit TierAdvanced(marketId, participant, 0, 1, jobId);
    }

    function gradeShortlist(uint256 marketId, address participant) external {
        Market storage m = markets[marketId];
        if (msg.sender != m.requester) revert NotRequester();

        Application storage app = _getApplication(marketId, participant);
        if (app.tierReached != 1) revert InvalidTierTransition(app.tierReached, 2);

        uint256 jobId = _createTierJob(marketId, participant, EchoHook.Tier.Shortlist);
        app.tierJobIds.push(jobId);
        app.tierReached = 2;

        participationReceipt.advanceTier(app.receiptTokenId, 2, m.tierAmounts[1]);
        emit TierAdvanced(marketId, participant, 1, 2, jobId);
    }

    function gradeFinal(uint256 marketId, address participant) external {
        Market storage m = markets[marketId];
        if (msg.sender != m.requester) revert NotRequester();

        Application storage app = _getApplication(marketId, participant);
        if (app.tierReached != 2) revert InvalidTierTransition(app.tierReached, 3);

        uint256 jobId = _createTierJob(marketId, participant, EchoHook.Tier.Final);
        app.tierJobIds.push(jobId);
        app.tierReached = 3;

        participationReceipt.advanceTier(app.receiptTokenId, 3, m.tierAmounts[2]);
        emit TierAdvanced(marketId, participant, 2, 3, jobId);
    }

    function closeMarket(uint256 marketId) external {
        Market storage m = markets[marketId];
        if (msg.sender != m.requester) revert NotRequester();
        if (m.closed) revert MarketAlreadyClosed();

        // Min-reveal floor (spec §6): a reveal market cannot be closed/refunded until the requester
        // has actually paid at least MIN_REVEALS reveals (capped by how many applied). This is the
        // anti-extraction binding — silence/harvest-then-refund is blocked.
        if (revealFee[marketId] > 0) {
            uint256 floor = m.applicantCount < MIN_REVEALS ? m.applicantCount : MIN_REVEALS;
            if (revealCount[marketId] < floor) revert RevealFloorNotMet();
        }

        m.closed = true;
        m.active = false;

        uint256 remaining = echoHook.remainingEscrow(marketId);
        if (remaining > 0) {
            echoHook.releaseEscrow(marketId, m.requester, remaining);
        }
        echoHook.releasePoolRemainder(marketId, m.requester);

        // Good-faith stake resolution (spec §4): a market that closes returns every outstanding
        // applicant stake — "expired/closed unrevealed → returned". A reveal hold that is still
        // Flagged (a live bait dispute) blocks close, mirroring Bounty's no-close-while-pending; a
        // Settled hold is already resolved (refundStake is a no-op). Bounded by maxApplicants.
        //
        // Worker-protection guard (folded into this loop to stay under EIP-170): block close while any
        // applicant's Final job is Submitted — a worker DELIVERED at Final but hasn't been resolved, so
        // the requester must Accept / Reject / Request revision first. A revert here rolls back the
        // escrow release above, so it's safe to check after the state change. Open/Completed/Rejected
        // all permit close.
        // Per-applicant close guards (the getJob struct-decode moved to EchoHook, so this stays under
        // the non-IR stack limit inline). Block close while: a reveal hold is still Flagged (live bait
        // dispute); a Final job is still Submitted (delivered, unresolved); or a Final job has a live
        // worker-recourse dispute (Rejected + contested — the Submitted check misses it).
        Application[] storage apps = marketApplications[marketId];
        for (uint256 i; i < apps.length; ++i) {
            Application storage app = apps[i];
            if (revealHolds[marketId][app.participant].status == EchoReveal.RevealStatus.Flagged) revert RevealStillFlagged();
            if (app.tierReached == 3 && app.tierJobIds.length > 0) {
                uint256 lastJob = app.tierJobIds[app.tierJobIds.length - 1];
                if (echoHook.jobIsSubmitted(lastJob)) revert FinalJobStillSubmitted();
                if (echoHook.tierJobDisputed(lastJob)) revert FinalJobDisputed();
            }
            echoHook.refundStake(marketId, app.participant);
        }

        emit MarketClosed(marketId, remaining);
    }

    // The P1 `adminSlashStake` owner-only placeholder became the P5 `slashStakeAdjudicated` and is
    // now (P6) `resolveStakeDispute` (gated to the DisputeResolver, in the adjudication-ladder
    // section below) — a stake slash now requires a real verdict against a FLAGGED reveal hold,
    // never a bare owner call. The EchoHook.slashStake settlement leg it routes through is unchanged
    // (it now also writes the applicant's -1 P-Rep).

    // ──────────────────── Mode B — Direct Job + milestones (spec §2.2) ────────────────────
    //
    // Thin forwarders over the EchoDirectJob delegatecall library (P5 size relief, spec §8). The
    // registry owns the shared id space + marketMode tag + requesterMarkets index; the library
    // owns validation / escrow / settlement / events, writing into the registry's own Mode B
    // mappings (passed by storage reference). Behaviour is identical to P3.

    /// @notice Create a two-party direct job. No applicant pool, teaser, reveal, or stake — the
    ///         parties already chose each other. The requester escrows the full job up front; the
    ///         escrow is split into milestones (use a single milestone for a tiny one-shot job).
    /// @param worker The chosen worker (the only address allowed to submit milestones).
    /// @param workerAgentId Worker's ERC-8004 identity, used for reputation/attribution.
    /// @param requesterAgentId Requester's identity (verified; receives R-Rep).
    /// @param milestoneAmounts Per-milestone amounts; their sum is the escrowed total.
    /// @param reviewWindow Seconds after a submission before that milestone may auto-release.
    function createDirectJob(
        address worker,
        uint256 workerAgentId,
        uint256 requesterAgentId,
        string calldata metadataURI,
        bytes32 scopeHash,
        uint256[] calldata milestoneAmounts,
        uint256 reviewWindow
    ) external returns (uint256 marketId) {
        marketId = ++marketCount;
        marketMode[marketId] = Mode.DirectJob;
        requesterMarkets[msg.sender].push(marketId);

        EchoDirectJob.createDirectJob(
            directJobs, directJobMilestones, _directJobDeps(), marketId,
            worker, workerAgentId, requesterAgentId, metadataURI, scopeHash, milestoneAmounts, reviewWindow
        );
    }

    /// @notice Worker delivers a milestone — starts that milestone's review/auto-release clock.
    function submitMilestone(uint256 marketId, uint256 index, bytes32 deliverableHash) external {
        _requireDirectJob(marketId);
        EchoDirectJob.submitMilestone(directJobs, directJobMilestones, marketId, index, deliverableHash);
    }

    /// @notice Requester accepts a submitted milestone — pays that slice to the worker now.
    function acceptMilestone(uint256 marketId, uint256 index) external {
        _requireDirectJob(marketId);
        EchoDirectJob.acceptMilestone(directJobs, directJobMilestones, _directJobDeps(), marketId, index);
    }

    /// @notice Anyone may release a submitted milestone once its review window has elapsed — the
    ///         exit-theft guard (accept-but-don't-pay): silence never profits the silent party.
    ///         Echo-native because Arc fires no expiry hook.
    function autoReleaseMilestone(uint256 marketId, uint256 index) external {
        _requireDirectJob(marketId);
        EchoDirectJob.autoReleaseMilestone(directJobs, directJobMilestones, _directJobDeps(), marketId, index);
    }

    /// @notice Requester stops the job. Refunds only PENDING (un-submitted) milestones; SUBMITTED
    ///         ones stay funded so the worker can still auto-release them (no clawback of delivered
    ///         work). Released milestones are already paid. Idempotent via the cancelled flag.
    function cancelDirectJob(uint256 marketId) external {
        _requireDirectJob(marketId);
        EchoDirectJob.cancelDirectJob(directJobs, directJobMilestones, _directJobDeps(), marketId);
    }

    function getDirectJobMilestones(uint256 marketId) external view returns (EchoDirectJob.Milestone[] memory) {
        return directJobMilestones[marketId];
    }

    /// @dev Mode guard for the direct-job forwarders. Preserves the NotDirectJob selector of P3.
    function _requireDirectJob(uint256 marketId) internal view {
        if (marketMode[marketId] != Mode.DirectJob) revert NotDirectJob();
    }

    /// @dev Bundle the contract handles the EchoDirectJob library needs into one memory struct.
    function _directJobDeps() internal view returns (EchoDirectJob.Deps memory) {
        return EchoDirectJob.Deps({
            echoHook: echoHook,
            usdc: usdc,
            identityRegistry: identityRegistry,
            attributionRegistry: attributionRegistry
        });
    }

    // ──────────────────── Mode Bounty — open submissions, parallel winners (spec §2.3) ────────────────────
    //
    // The bounty lifecycle bodies live in the EchoBounty delegatecall library (P5 size relief, spec
    // §8). These are thin forwarders: the registry owns the shared id space (marketCount), the
    // marketMode tag, and the requesterMarkets index — all registry-private state — and delegates
    // validation / escrow / settlement / events to the library, which writes directly into the
    // registry's own bounty mappings (passed by storage reference). Behaviour is identical to P4.

    /// @notice Create an open bounty. The requester escrows a pool; many submitters post exposed
    ///         findings and many can be paid in parallel. Awards are bounded below by defaultAward
    ///         (the floor + the amount an ignored finding auto-escalates to) and above by the
    ///         remaining pool.
    /// @param requiredProofs Submitter genesis-filter bitmask (reuses ValidationGate).
    /// @param defaultAward Per-accepted-finding floor and the auto-escalation payout.
    /// @param reviewWindow Seconds after a submission before it may auto-escalate on requester silence.
    /// @param pool Total escrowed reward pool.
    function createBounty(
        uint256 requesterAgentId,
        string calldata metadataURI,
        bytes32 scopeHash,
        uint256 requiredProofs,
        uint256 defaultAward,
        uint256 reviewWindow,
        uint256 pool
    ) external returns (uint256 marketId) {
        marketId = ++marketCount;
        marketMode[marketId] = Mode.Bounty;
        requesterMarkets[msg.sender].push(marketId);

        EchoBounty.createBounty(
            bounties, _bountyDeps(), marketId,
            requesterAgentId, metadataURI, scopeHash, requiredProofs, defaultAward, reviewWindow, pool
        );
    }

    /// @notice Submit an exposed finding to a bounty. Open to anyone passing the genesis filter
    ///         (the spam wall); one submitter may post many findings. The hash commits to a result
    ///         shared openly off-chain (exposed, the opposite of Mode A's gated disclosure).
    function submitFinding(uint256 marketId, uint256 submitterAgentId, bytes32 findingHash) external returns (uint256 index) {
        _requireBounty(marketId);
        return EchoBounty.submitFinding(
            bounties, bountyFindings, bountyPendingCount, _bountyDeps(), marketId, submitterAgentId, findingHash
        );
    }

    /// @notice Requester accepts a finding and pays `award` (>= defaultAward, <= remaining pool) to
    ///         its submitter. Many findings can be accepted in parallel — multiple winners.
    function acceptFinding(uint256 marketId, uint256 index, uint256 award) external {
        _requireBounty(marketId);
        EchoBounty.acceptFinding(bounties, bountyFindings, bountyPendingCount, _bountyDeps(), marketId, index, award);
    }

    /// @notice Requester rejects a finding (free, and disputable via the P5 adjudication ladder).
    ///         The active alternative to accepting — so close never deadlocks on a bad finding.
    ///         Auto-escalation guards against being IGNORED, not against an honest rejection.
    function rejectFinding(uint256 marketId, uint256 index) external {
        _requireBounty(marketId);
        EchoBounty.rejectFinding(bounties, bountyFindings, bountyPendingCount, marketId, index);
    }

    /// @notice Anyone may force-accept a Pending finding for defaultAward once its review window has
    ///         elapsed — the ignore-theft guard (spec §2.3): a requester cannot harvest exposed
    ///         findings and sit on them. Echo-native (Arc fires no expiry hook). Capped at the
    ///         remaining pool so it can never over-draw.
    function autoEscalateFinding(uint256 marketId, uint256 index) external {
        _requireBounty(marketId);
        EchoBounty.autoEscalateFinding(bounties, bountyFindings, bountyPendingCount, _bountyDeps(), marketId, index);
    }

    /// @notice Close a bounty and refund the unspent pool. Blocked while any finding is still
    ///         Pending or Disputed (no-reclaim-while-pending) — every finding must be accepted,
    ///         rejected, or auto-escalated, and any dispute resolved, before reclaim.
    function closeBounty(uint256 marketId) external {
        _requireBounty(marketId);
        EchoBounty.closeBounty(bounties, bountyPendingCount, _bountyDeps(), marketId);
    }

    function getBountyFindings(uint256 marketId) external view returns (EchoBounty.Finding[] memory) {
        return bountyFindings[marketId];
    }

    /// @dev Mode guard for the bounty forwarders. The library checks `b.requester != 0` too, but
    ///      gating on marketMode here keeps the NotBounty selector semantics of P4 (a non-bounty
    ///      id reverts NotBounty, not a library-internal error) and avoids the delegatecall.
    function _requireBounty(uint256 marketId) internal view {
        if (marketMode[marketId] != Mode.Bounty) revert NotBounty();
    }

    /// @dev Bundle the contract handles the EchoBounty library needs into one memory struct.
    function _bountyDeps() internal view returns (EchoBounty.Deps memory) {
        return EchoBounty.Deps({
            echoHook: echoHook,
            usdc: usdc,
            identityRegistry: identityRegistry,
            validationGate: validationGate,
            attributionRegistry: attributionRegistry
        });
    }

    // ──────────────────── P5 adjudication ladder wiring (spec §5) ────────────────────

    modifier onlyDisputeResolver() {
        if (msg.sender != disputeResolver) revert NotDisputeResolver();
        _;
    }

    /// @notice Wire the staked-jury rung (DisputeResolver sibling). Set once; until then no
    ///         dispute callback can fire, so this is additive and migration-free.
    function setDisputeResolver(address _disputeResolver) external onlyOwner {
        if (disputeResolver != address(0)) revert AlreadySet();
        if (_disputeResolver == address(0)) revert ZeroAddress();
        disputeResolver = _disputeResolver;
        emit DisputeResolverSet(_disputeResolver);
    }

    /// @notice Move a Rejected bounty finding into Disputed (re-counts it as pending so close is
    ///         blocked while contested). Driven by the DisputeResolver when a submitter opens a
    ///         dispute against a rejection. Only the wired resolver may call this.
    function markFindingDisputed(uint256 marketId, uint256 index) external onlyDisputeResolver {
        _requireBounty(marketId);
        EchoBounty.markFindingDisputed(bountyFindings, bountyPendingCount, marketId, index);
    }

    /// @notice Settle a disputed finding per the jury verdict: `findingValid == true` pays the
    ///         submitter the floor (capped at the remaining pool) and marks it Accepted; `false`
    ///         returns it to Rejected. Driven by the DisputeResolver on resolve. The reveal/accept
    ///         money path is never clawed back — this only acts on the disputed finding.
    function resolveDisputedFinding(uint256 marketId, uint256 index, bool findingValid) external onlyDisputeResolver {
        _requireBounty(marketId);
        EchoBounty.resolveDisputedFinding(
            bounties, bountyFindings, bountyPendingCount, _bountyDeps(), marketId, index, findingValid
        );
    }

    /// @notice Flag a held Mode-A reveal as contested (P6). Driven by the DisputeResolver when the
    ///         requester opens a bonded ModeAStake dispute — mirrors markFindingDisputed. Reverting
    ///         in the library (RevealNotHeld / FlagWindowElapsed) unwinds the opener's bond. Freezing
    ///         as Flagged blocks both the auto-return (settleRevealStake) and closeMarket until the
    ///         jury rules. Thin forwarder over the EchoReveal library.
    function markRevealFlagged(uint256 marketId, address participant) external onlyDisputeResolver {
        EchoReveal.markRevealFlagged(revealHolds, revealFlagWindow, marketId, participant);
    }

    /// @notice Settle a flagged reveal stake per the jury verdict (P6) — the adjudicated replacement
    ///         for the P1 adminSlashStake placeholder. `slash == true` is a sustained bait-and-switch:
    ///         forfeit the stake to the requester (the harmed party); `false` clears the applicant and
    ///         refunds the stake. Both outcomes resolve the hold so the stake is never stranded. The
    ///         registry supplies the requester + applicant agentId (its own state); EchoHook.slashStake
    ///         writes the -1 P-Rep. The reveal/accept money path is never clawed back.
    function resolveStakeDispute(uint256 marketId, address participant, bool slash) external onlyDisputeResolver {
        EchoReveal.resolveStakeDispute(
            revealHolds, echoHook, marketId, participant,
            markets[marketId].requester, _getApplication(marketId, participant).agentId, slash
        );
    }

    /// @notice Mark a Rejected Final-tier job as disputed (worker recourse, mirrors markFindingDisputed).
    ///         Driven by the DisputeResolver when the job's worker opens a bonded TierJobRejection
    ///         dispute. Verifies — against Arc + EchoHook state — that `opener` is the job's provider,
    ///         the job is a Rejected Final job of THIS market, and it isn't already disputed; any revert
    ///         unwinds the opener's bond in the resolver. Blocks closeMarket while the dispute is live.
    function markTierJobDisputed(uint256 marketId, uint256 jobId, address opener) external onlyDisputeResolver {
        // Thin forwarder — EchoHook validates (provider == opener, Arc status Rejected, Final job of
        // this market, not already disputed) and owns the `tierJobDisputed` flag closeMarket reads.
        echoHook.markTierJobDisputed(marketId, jobId, opener);
    }

    /// @notice Settle a disputed Final-tier job per the jury verdict. `workerWon == true` overturns the
    ///         rejection — EchoHook pays the worker the tier amount (net of fee) from escrow and writes
    ///         the completion reputation; `false` confirms the rejection (no money moves; the escrow
    ///         refunds the requester on close). Clears the disputed flag BEFORE the external call (CEI)
    ///         so the market can close once resolved. Only the wired resolver may call this.
    function resolveTierJobDispute(uint256, uint256 jobId, bool workerWon) external onlyDisputeResolver {
        // Thin forwarder — EchoHook clears its `tierJobDisputed` flag (reverting TierJobNotDisputed if
        // not open) and settles the escrow: pays the worker on a win, leaves it for the requester's
        // close refund on a loss.
        echoHook.settleDisputedTier(jobId, workerWon);
    }

    function _calculateMinEscrow(
        uint256[4] calldata tierAmounts,
        uint256 maxApplicants,
        uint256
    ) internal pure returns (uint256) {
        uint256 estimatedSubstantive = maxApplicants / 5;
        uint256 estimatedShortlist = maxApplicants / 20;
        uint256 estimatedFinal = maxApplicants / 50;
        uint256 ghostReserve = tierAmounts[3];

        return
            (estimatedSubstantive * tierAmounts[0]) +
            (estimatedShortlist * tierAmounts[1]) +
            (estimatedFinal * tierAmounts[2]) +
            ghostReserve;
    }

    function _getApplication(uint256 marketId, address participant) internal view returns (Application storage) {
        uint256 idx = participantApplicationIndex[marketId][participant];
        if (idx == 0) revert NotParticipant();
        return marketApplications[marketId][idx - 1];
    }

    function _createTierJob(
        uint256 marketId,
        address participant,
        EchoHook.Tier tier
    ) internal returns (uint256 jobId) {
        Market storage m = markets[marketId];
        Application storage app = _getApplication(marketId, participant);
        uint256 participantAgentId = app.agentId;
        uint256 requesterAgentId = m.requesterAgentId;

        uint256 expiration = block.timestamp + 30 days;
        if (tier == EchoHook.Tier.Final) {
            expiration = block.timestamp + m.ghostDeadline;
        }

        // Arc's createJob takes a human-readable string description and requires the hook to
        // be whitelisted by Arc admins + advertise IACPHook via ERC-165. Echo creates the job
        // with budget == 0 (set later via setBudget/fund only if needed) and settles tier
        // payouts itself from EchoHook escrow on the `complete` callback.
        jobId = agenticCommerce.createJob(
            participant,
            m.requester,
            expiration,
            m.metadataURI,
            address(echoHook)
        );

        EchoHook.MarketContext memory marketCtx = EchoHook.MarketContext({
            marketId: marketId,
            participantAgentId: participantAgentId,
            requesterAgentId: requesterAgentId,
            tier: tier,
            ghostDeadline: block.timestamp + m.ghostDeadline,
            tierAmount: m.tierAmounts[uint8(tier) - 1],
            ghostTriggered: false,
            disputeSettled: false
        });

        echoHook.initJobContext(jobId, marketCtx);
    }

    /// @notice Echo-native ghost trigger. Arc fires no expiry hook, so once a participant's
    ///         Final-tier job passes its ghost deadline uncompleted, anyone may trigger the
    ///         penalty payout to the worker (and R-Rep slash of the requester) via EchoHook.
    function triggerGhost(uint256 marketId, address participant) external {
        Application storage app = _getApplication(marketId, participant);
        if (app.tierReached != 3 || app.tierJobIds.length == 0) revert InvalidTierTransition(app.tierReached, 3);
        uint256 finalJobId = app.tierJobIds[app.tierJobIds.length - 1];
        echoHook.triggerGhost(finalJobId);
    }

    function getRequesterMarkets(address requester) external view returns (uint256[] memory) {
        return requesterMarkets[requester];
    }

    function getMarketApplications(uint256 marketId) external view returns (Application[] memory) {
        return marketApplications[marketId];
    }

    function getApplication(uint256 marketId, address participant) external view returns (Application memory) {
        return _getApplication(marketId, participant);
    }

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
