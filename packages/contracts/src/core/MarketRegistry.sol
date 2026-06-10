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
