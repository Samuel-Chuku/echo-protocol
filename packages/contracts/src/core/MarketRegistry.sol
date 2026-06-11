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

/**
 * @title MarketRegistry
 * @notice Upgradeable Echo market factory. Lets requesters create markets, fund escrow pools,
 *         and spawns ERC-8183 jobs per tier transition for each participant.
 * @dev Uses UUPS proxy pattern for upgradeability.
 */
contract MarketRegistry is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    /// @notice Selectable market shape (spec §2). P1 builds the Open Market lifecycle; Direct Job
    ///         and Bounty are stored-but-guarded until their lifecycles land (P3 / P4).
    enum Mode {
        OpenMarket, // A — multi-stage funnel (the existing tiered flow)
        DirectJob,  // B — two known parties + milestones (P3)
        Bounty      // open submissions, parallel winners (P4)
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

    /// @notice Mode B milestone lifecycle (spec §2.2): Pending → Submitted → Released. A submitted
    ///         milestone is protected by the auto-release clock; a released one cannot be clawed back.
    enum MilestoneStatus { Pending, Submitted, Released }

    /// @notice A two-party direct job (Mode B). No applicant pool, teaser, reveal, or stake — the
    ///         parties already chose each other. Escrow custody reuses EchoHook (escrowed[marketId]).
    struct DirectJob {
        address requester;
        address worker;
        uint256 workerAgentId;     // for reputation/attribution (supplied by requester, unverified)
        uint256 requesterAgentId;
        bytes32 scopeHash;
        string metadataURI;
        uint256 reviewWindow;      // seconds after submit before a milestone may auto-release
        bool cancelled;
    }

    struct Milestone {
        uint256 amount;
        uint64 submittedAt;        // 0 until submitted; deadline = submittedAt + reviewWindow
        MilestoneStatus status;
        bytes32 deliverableHash;
    }

    /// @notice Mode Bounty finding lifecycle (spec §2.3): Pending → Accepted (paid) or Rejected
    ///         (free, disputable in P5). Ignored Pending findings auto-escalate past their deadline.
    enum FindingStatus { Pending, Accepted, Rejected }

    /// @notice An open bounty (Mode Bounty). Many submit exposed findings; many get paid in
    ///         parallel. Pool custody reuses EchoHook (escrowed[marketId]).
    struct Bounty {
        address requester;
        uint256 requesterAgentId;
        bytes32 scopeHash;
        string metadataURI;
        uint256 requiredProofs;  // submitter genesis filter (reuses ValidationGate)
        uint256 defaultAward;    // floor per accepted finding + the amount an auto-escalation pays
        uint256 reviewWindow;    // seconds after submit before a finding may auto-escalate
        bool closed;
    }

    struct Finding {
        address submitter;
        uint256 submitterAgentId;
        bytes32 findingHash;     // commitment to the publicly-shared (exposed) result
        uint64 submittedAt;
        FindingStatus status;
        uint256 award;           // paid amount once Accepted (0 otherwise)
    }

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
    mapping(uint256 => DirectJob) public directJobs;
    mapping(uint256 => Milestone[]) public directJobMilestones;

    // --- Mode Bounty (P4), appended storage (UUPS-safe). Shares the marketCount id space. ---
    mapping(uint256 => Bounty) public bounties;
    mapping(uint256 => Finding[]) public bountyFindings;
    mapping(uint256 => uint256) public bountyPendingCount; // open (Pending) findings, for the no-reclaim guard

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

    /// @notice Create a market with an explicit mode + genesis filter (spec §2/§3/§4).
    /// @param mode Market shape. P1 supports Open Market only; Direct Job / Bounty revert
    ///        UnsupportedMode until their lifecycles land (P3 / P4) — no escrow into a mode with
    ///        no exit path.
    /// @param requiredProofs Requester's accepted-proof bitmask (must include PROOF_IDENTITY).
    /// @param stakeRequired Per-applicant returnable stake S (anti-bait bond; 0 = none).
    function createMarketWithMode(
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
    ) external returns (uint256 marketId) {
        if (mode != Mode.OpenMarket) revert UnsupportedMode();

        // Mode A is a reveal market: the first tier is the reveal, fee R = tierAmounts[0].
        uint256 fee = tierAmounts[0];
        // Min-reveal escrow binding (spec §6): fund at least MIN_REVEALS reveals.
        if (escrowTotal < fee * MIN_REVEALS) revert InsufficientEscrow(escrowTotal, fee * MIN_REVEALS);
        // Stake sizing S >= R (spec §4): a bad reveal at least refunds what the requester paid to look.
        if (stakeRequired > 0 && stakeRequired < fee) revert StakeTooSmall();

        marketId = _create(
            metadataURI, scopeHash, tierAmounts, minPRep, maxApplicants, ghostDeadline,
            escrowTotal, requesterAgentId, mode, requiredProofs | PROOF_IDENTITY, stakeRequired
        );
        revealFee[marketId] = fee;
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
    ///         the applicant's stake is refunded and R is paid out — atomic exchange, so looking IS
    ///         the payment trigger and harvest-before-pay is structurally impossible. Content
    ///         delivery is app-mediated off-chain (to this requester only); the money is on-chain
    ///         and trustless. Advances the applicant to tier 1, sitting below the existing
    ///         shortlist/final tiers.
    function reveal(uint256 marketId, address participant) external {
        Market storage m = markets[marketId];
        if (msg.sender != m.requester) revert NotRequester();
        if (m.closed) revert MarketAlreadyClosed();
        if (revealFee[marketId] == 0) revert NotRevealMarket();

        Application storage app = _getApplication(marketId, participant);
        if (app.tierReached != 0) revert InvalidTierTransition(app.tierReached, 1);

        uint256 fee = revealFee[marketId];

        // Atomic exchange: refund the stake and pay the reveal fee (net of protocol fee, with the
        // AR overlay earning on the reveal) in one transaction.
        echoHook.refundStake(marketId, participant);
        echoHook.settleReveal(marketId, participant, app.agentId, m.requesterAgentId, fee);

        app.tierReached = 1;
        revealCount[marketId] += 1;
        participationReceipt.advanceTier(app.receiptTokenId, 1, fee);

        if (address(attributionRegistry) != address(0)) {
            attributionRegistry.recordGrade(app.agentId, msg.sender);
        }

        emit Revealed(marketId, participant, fee);
        emit TierAdvanced(marketId, participant, 0, 1, 0);
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
        // applicant stake — "expired/closed unrevealed → returned". Bounded by maxApplicants.
        Application[] storage apps = marketApplications[marketId];
        for (uint256 i; i < apps.length; ++i) {
            echoHook.refundStake(marketId, apps[i].participant);
        }

        emit MarketClosed(marketId, remaining);
    }

    /// @notice Forfeit an applicant's stake to the requester (the harmed party). PLACEHOLDER:
    ///         a legitimate slash requires a sustained bait-and-switch flag (P5 DisputeResolver)
    ///         or a post-engagement no-show (P6 engine), neither of which exists yet — so this is
    ///         gated to the protocol owner and is NOT a live participant-facing action. P5/P6
    ///         replace the caller with the adjudicated path; the EchoHook.slashStake settlement
    ///         leg they call is already built.
    function adminSlashStake(uint256 marketId, address participant) external onlyOwner {
        address to = markets[marketId].requester;
        echoHook.slashStake(marketId, participant, to);
        emit StakeSlashed(marketId, participant, to);
    }

    // ──────────────────── Mode B — Direct Job + milestones (spec §2.2) ────────────────────

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
        if (milestoneAmounts.length == 0) revert NoMilestones();
        if (worker == address(0)) revert ZeroAddress();
        if (!identityRegistry.isAuthorizedOrOwner(msg.sender, requesterAgentId)) revert NotAgentOwner();

        uint256 total;
        for (uint256 i; i < milestoneAmounts.length; ++i) {
            total += milestoneAmounts[i];
        }

        marketId = ++marketCount;
        marketMode[marketId] = Mode.DirectJob;

        directJobs[marketId] = DirectJob({
            requester: msg.sender,
            worker: worker,
            workerAgentId: workerAgentId,
            requesterAgentId: requesterAgentId,
            scopeHash: scopeHash,
            metadataURI: metadataURI,
            reviewWindow: reviewWindow,
            cancelled: false
        });

        Milestone[] storage ms = directJobMilestones[marketId];
        for (uint256 i; i < milestoneAmounts.length; ++i) {
            ms.push(Milestone({amount: milestoneAmounts[i], submittedAt: 0, status: MilestoneStatus.Pending, deliverableHash: bytes32(0)}));
        }

        requesterMarkets[msg.sender].push(marketId);

        usdc.safeTransferFrom(msg.sender, address(echoHook), total);
        echoHook.fundEscrow(marketId, total);

        emit DirectJobCreated(marketId, msg.sender, worker, total, milestoneAmounts.length);
    }

    /// @notice Worker delivers a milestone — starts that milestone's review/auto-release clock.
    function submitMilestone(uint256 marketId, uint256 index, bytes32 deliverableHash) external {
        DirectJob storage j = _getDirectJob(marketId);
        if (msg.sender != j.worker) revert NotWorker();
        if (j.cancelled) revert JobCancelled();

        Milestone storage milestone = _getMilestone(marketId, index);
        if (milestone.status != MilestoneStatus.Pending) revert MilestoneNotPending();

        milestone.status = MilestoneStatus.Submitted;
        milestone.submittedAt = uint64(block.timestamp);
        milestone.deliverableHash = deliverableHash;

        emit MilestoneSubmitted(marketId, index, deliverableHash);
    }

    /// @notice Requester accepts a submitted milestone — pays that slice to the worker now.
    function acceptMilestone(uint256 marketId, uint256 index) external {
        DirectJob storage j = _getDirectJob(marketId);
        if (msg.sender != j.requester) revert NotRequester();
        Milestone storage milestone = _getMilestone(marketId, index);
        if (milestone.status != MilestoneStatus.Submitted) revert MilestoneNotSubmitted();
        _releaseMilestone(marketId, index, j, milestone, false);
    }

    /// @notice Anyone may release a submitted milestone once its review window has elapsed — the
    ///         exit-theft guard (accept-but-don't-pay): silence never profits the silent party.
    ///         Echo-native because Arc fires no expiry hook.
    function autoReleaseMilestone(uint256 marketId, uint256 index) external {
        DirectJob storage j = _getDirectJob(marketId);
        Milestone storage milestone = _getMilestone(marketId, index);
        if (milestone.status != MilestoneStatus.Submitted) revert MilestoneNotSubmitted();
        if (block.timestamp < uint256(milestone.submittedAt) + j.reviewWindow) revert ReviewWindowNotElapsed();
        _releaseMilestone(marketId, index, j, milestone, true);
    }

    /// @notice Requester stops the job. Refunds only PENDING (un-submitted) milestones; SUBMITTED
    ///         ones stay funded so the worker can still auto-release them (no clawback of delivered
    ///         work). Released milestones are already paid. Idempotent via the cancelled flag.
    function cancelDirectJob(uint256 marketId) external {
        DirectJob storage j = _getDirectJob(marketId);
        if (msg.sender != j.requester) revert NotRequester();
        if (j.cancelled) revert JobCancelled();
        j.cancelled = true;

        uint256 refund;
        Milestone[] storage ms = directJobMilestones[marketId];
        for (uint256 i; i < ms.length; ++i) {
            if (ms[i].status == MilestoneStatus.Pending) {
                refund += ms[i].amount;
            }
        }
        if (refund > 0) {
            echoHook.releaseEscrow(marketId, j.requester, refund);
        }

        emit DirectJobCancelled(marketId, refund);
    }

    function _releaseMilestone(
        uint256 marketId,
        uint256 index,
        DirectJob storage j,
        Milestone storage milestone,
        bool autoReleased
    ) internal {
        milestone.status = MilestoneStatus.Released;
        echoHook.settleMilestone(marketId, j.worker, j.workerAgentId, j.requesterAgentId, milestone.amount);

        // A released milestone is an independent grade of the worker (confirms ARs, like Mode A).
        if (address(attributionRegistry) != address(0)) {
            attributionRegistry.recordGrade(j.workerAgentId, j.requester);
        }

        emit MilestoneReleased(marketId, index, milestone.amount, autoReleased);
    }

    function _getDirectJob(uint256 marketId) internal view returns (DirectJob storage j) {
        if (marketMode[marketId] != Mode.DirectJob) revert NotDirectJob();
        j = directJobs[marketId];
    }

    function _getMilestone(uint256 marketId, uint256 index) internal view returns (Milestone storage) {
        Milestone[] storage ms = directJobMilestones[marketId];
        if (index >= ms.length) revert BadMilestoneIndex();
        return ms[index];
    }

    function getDirectJobMilestones(uint256 marketId) external view returns (Milestone[] memory) {
        return directJobMilestones[marketId];
    }

    // ──────────────────── Mode Bounty — open submissions, parallel winners (spec §2.3) ────────────────────

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
        if (defaultAward == 0 || pool < defaultAward) revert InsufficientEscrow(pool, defaultAward);
        if (!identityRegistry.isAuthorizedOrOwner(msg.sender, requesterAgentId)) revert NotAgentOwner();

        marketId = ++marketCount;
        marketMode[marketId] = Mode.Bounty;

        bounties[marketId] = Bounty({
            requester: msg.sender,
            requesterAgentId: requesterAgentId,
            scopeHash: scopeHash,
            metadataURI: metadataURI,
            requiredProofs: requiredProofs | PROOF_IDENTITY,
            defaultAward: defaultAward,
            reviewWindow: reviewWindow,
            closed: false
        });

        requesterMarkets[msg.sender].push(marketId);

        usdc.safeTransferFrom(msg.sender, address(echoHook), pool);
        echoHook.fundEscrow(marketId, pool);

        emit BountyCreated(marketId, msg.sender, pool, defaultAward);
    }

    /// @notice Submit an exposed finding to a bounty. Open to anyone passing the genesis filter
    ///         (the spam wall); one submitter may post many findings. The hash commits to a result
    ///         shared openly off-chain (exposed, the opposite of Mode A's gated disclosure).
    function submitFinding(uint256 marketId, uint256 submitterAgentId, bytes32 findingHash) external returns (uint256 index) {
        Bounty storage b = _getBounty(marketId);
        if (b.closed) revert BountyIsClosed();

        // Genesis filter (spec §3): same gate as Mode A entry, validation not reputation.
        if (address(validationGate) != address(0)) {
            if (!validationGate.validate(submitterAgentId, msg.sender, b.requiredProofs)) revert ValidationFailed();
        } else if (!identityRegistry.isAuthorizedOrOwner(msg.sender, submitterAgentId)) {
            revert NotAgentOwner();
        }

        Finding[] storage fs = bountyFindings[marketId];
        index = fs.length;
        fs.push(Finding({
            submitter: msg.sender,
            submitterAgentId: submitterAgentId,
            findingHash: findingHash,
            submittedAt: uint64(block.timestamp),
            status: FindingStatus.Pending,
            award: 0
        }));
        bountyPendingCount[marketId] += 1;

        emit FindingSubmitted(marketId, index, msg.sender, findingHash);
    }

    /// @notice Requester accepts a finding and pays `award` (>= defaultAward, <= remaining pool) to
    ///         its submitter. Many findings can be accepted in parallel — multiple winners.
    function acceptFinding(uint256 marketId, uint256 index, uint256 award) external {
        Bounty storage b = _getBounty(marketId);
        if (msg.sender != b.requester) revert NotRequester();
        Finding storage f = _getFinding(marketId, index);
        if (f.status != FindingStatus.Pending) revert FindingNotPending();
        if (award < b.defaultAward) revert AwardBelowFloor();
        if (award > echoHook.remainingEscrow(marketId)) revert AwardExceedsPool();
        _acceptFinding(marketId, index, b, f, award, false);
    }

    /// @notice Requester rejects a finding (free, and disputable via the P5 adjudication ladder).
    ///         The active alternative to accepting — so close never deadlocks on a bad finding.
    ///         Auto-escalation guards against being IGNORED, not against an honest rejection.
    function rejectFinding(uint256 marketId, uint256 index) external {
        Bounty storage b = _getBounty(marketId);
        if (msg.sender != b.requester) revert NotRequester();
        Finding storage f = _getFinding(marketId, index);
        if (f.status != FindingStatus.Pending) revert FindingNotPending();

        f.status = FindingStatus.Rejected;
        bountyPendingCount[marketId] -= 1;
        emit FindingRejected(marketId, index);
    }

    /// @notice Anyone may force-accept a Pending finding for defaultAward once its review window has
    ///         elapsed — the ignore-theft guard (spec §2.3): a requester cannot harvest exposed
    ///         findings and sit on them. Echo-native (Arc fires no expiry hook). Capped at the
    ///         remaining pool so it can never over-draw.
    function autoEscalateFinding(uint256 marketId, uint256 index) external {
        Bounty storage b = _getBounty(marketId);
        Finding storage f = _getFinding(marketId, index);
        if (f.status != FindingStatus.Pending) revert FindingNotPending();
        if (block.timestamp < uint256(f.submittedAt) + b.reviewWindow) revert ReviewWindowNotElapsed();

        uint256 award = b.defaultAward;
        uint256 remaining = echoHook.remainingEscrow(marketId);
        if (award > remaining) award = remaining;
        _acceptFinding(marketId, index, b, f, award, true);
    }

    /// @notice Close a bounty and refund the unspent pool. Blocked while any finding is still
    ///         Pending (no-reclaim-while-pending) — every finding must be accepted, rejected, or
    ///         auto-escalated first, so a requester cannot reclaim over unjudged work.
    function closeBounty(uint256 marketId) external {
        Bounty storage b = _getBounty(marketId);
        if (msg.sender != b.requester) revert NotRequester();
        if (b.closed) revert BountyIsClosed();
        if (bountyPendingCount[marketId] != 0) revert FindingsStillPending();

        b.closed = true;
        uint256 remaining = echoHook.remainingEscrow(marketId);
        if (remaining > 0) {
            echoHook.releaseEscrow(marketId, b.requester, remaining);
        }
        emit BountyClosed(marketId, remaining);
    }

    function _acceptFinding(
        uint256 marketId,
        uint256 index,
        Bounty storage b,
        Finding storage f,
        uint256 award,
        bool autoEscalated
    ) internal {
        f.status = FindingStatus.Accepted;
        f.award = award;
        bountyPendingCount[marketId] -= 1;

        echoHook.settleFinding(marketId, f.submitter, f.submitterAgentId, b.requesterAgentId, award);

        // An accepted finding is an independent grade of the submitter (confirms ARs, like Mode A/B).
        if (address(attributionRegistry) != address(0)) {
            attributionRegistry.recordGrade(f.submitterAgentId, b.requester);
        }

        emit FindingAccepted(marketId, index, award, autoEscalated);
    }

    function _getBounty(uint256 marketId) internal view returns (Bounty storage b) {
        if (marketMode[marketId] != Mode.Bounty) revert NotBounty();
        b = bounties[marketId];
    }

    function _getFinding(uint256 marketId, uint256 index) internal view returns (Finding storage) {
        Finding[] storage fs = bountyFindings[marketId];
        if (index >= fs.length) revert BadFindingIndex();
        return fs[index];
    }

    function getBountyFindings(uint256 marketId) external view returns (Finding[] memory) {
        return bountyFindings[marketId];
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
            ghostTriggered: false
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
