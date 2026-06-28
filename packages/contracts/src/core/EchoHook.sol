// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IAgenticCommerce} from "../interfaces/IERC8183.sol";
import {IReputationRegistry} from "../interfaces/IERC8004.sol";
import {IACPHook} from "../interfaces/IACPHook.sol";
import {AttributionPayout} from "./AttributionPayout.sol";
import {AttributionRegistry} from "./AttributionRegistry.sol";

/**
 * @title EchoHook
 * @notice Upgradeable. The heart of Echo Protocol. Implements Arc's generic ERC-8183
 *         hook interface (`IACPHook`): AgenticCommerce calls `beforeAction`/`afterAction
 *         (jobId, selector, data)` on every job-lifecycle transition, and EchoHook
 *         branches on the selector to drive tier payouts, ghost penalties, attribution
 *         settlement and reputation writes.
 *
 *         Money model: Echo custodies its own escrow here (funded by MarketRegistry on
 *         createMarket) and creates AgenticCommerce jobs with budget == 0, so Arc moves
 *         no funds for Echo jobs — all tiered payouts/fees/attribution are settled from
 *         this contract in `afterAction(complete)`.
 *
 *         Ghost path: Arc fires NO hook on expiry (`claimRefund` is silent), so the ghost
 *         penalty is Echo-native — `triggerGhost` is driven by MarketRegistry, not Arc.
 * @dev UUPS proxy. Storage layout is unchanged from the prior version (only the callback
 *      surface changed: on*-callbacks → IACPHook before/afterAction + triggerGhost), so it
 *      upgrades in place. Verify with `forge inspect EchoHook storageLayout` before deploy.
 */
contract EchoHook is Initializable, OwnableUpgradeable, UUPSUpgradeable, IACPHook {
    using SafeERC20 for IERC20;

    enum Tier {
        Submitted,
        Substantive,
        Shortlist,
        Final,
        Ghost,
        Milestone, // Mode B direct-job milestone release (P3). Appended — enum is uint8, layout-safe.
        Finding    // Bounty accepted-finding payout (P4). Appended — layout-safe.
    }

    struct MarketContext {
        uint256 marketId;
        uint256 participantAgentId;
        uint256 requesterAgentId;
        Tier tier;
        uint256 ghostDeadline;
        uint256 tierAmount;
        bool ghostTriggered;
    }

    IAgenticCommerce public agenticCommerce;
    IReputationRegistry public reputationRegistry;
    IERC20 public usdc;
    address public marketRegistry;

    mapping(uint256 => MarketContext) public ctx;
    mapping(uint256 => uint256[4]) public tierAmounts;
    mapping(uint256 => uint256) public escrowed;
    mapping(uint256 => uint256) public distributed;

    // --- Protocol fee + attribution (appended storage, UUPS-safe) ---
    uint16 public protocolFeeBps;          // Echo's take-rate on each successful payout
    address public protocolTreasury;       // receives margin (fee minus attribution)
    AttributionPayout public attributionPayout;
    AttributionRegistry public attributionRegistry;

    // Requester-funded attribution pool, per market (separate from Echo's fee).
    mapping(uint256 => uint256) public poolEscrowed;
    mapping(uint256 => uint256) public poolDistributed;
    mapping(uint256 => uint16) public poolShareBps;

    // --- Returnable applicant stake (P1: mode + entry foundations), appended storage, UUPS-safe ---
    // The anti-bait-and-switch bond (spec §4). Custodied here alongside escrow but accounted
    // SEPARATELY from escrowed/distributed — refunds/slashes draw only from stakeBalance, so
    // remainingEscrow() math is untouched and applicant capital never commingles with the pool.
    mapping(uint256 => mapping(address => uint256)) public stakeBalance; // marketId => participant => locked

    // --- Final-tier revision window (appended storage, UUPS-safe) ---
    // A requester may send a Submitted Final job back for revision ONCE. That reopens the Arc job
    // (Submitted → Open) and resets the ghost deadline to now + REVISION_BASE. The worker may then
    // self-extend the window up to MAX_REVISION_EXTENSIONS times by a decreasing grant. Tracked as a
    // flag + counter per jobId so it never touches the MarketContext struct MarketRegistry builds.
    mapping(uint256 => bool)  public revisionUsed;       // one revision per Final job
    mapping(uint256 => uint8) public revisionExtensions; // worker self-extensions used (max 3)

    event TierPayout(
        uint256 indexed marketId,
        uint256 indexed jobId,
        address indexed participant,
        Tier tier,
        uint256 amount
    );
    event GhostPenalty(
        uint256 indexed marketId,
        uint256 indexed jobId,
        address indexed participant,
        uint256 amount,
        address requester
    );
    event RRepSlashed(
        uint256 indexed requesterAgentId,
        uint256 indexed marketId,
        uint256 amount
    );
    /// @notice Worker-side ghost: Final-tier deadline elapsed while the Arc job was still Open
    ///         (worker never submitted). No payout moves; the ghost reserve stays in escrow and
    ///         refunds on closeMarket. Worker's P-Rep gets a -1 "worker_ghosted" feedback;
    ///         requester is untouched. Emitted instead of GhostPenalty in this branch so the
    ///         indexer can tell the two cases apart.
    event WorkerGhosted(
        uint256 indexed marketId,
        uint256 indexed jobId,
        address indexed participant,
        uint256 participantAgentId
    );
    event RegistrySet(address indexed registry);
    event AgenticCommerceSet(address indexed agenticCommerce);
    event ProtocolConfigured(uint16 feeBps, address treasury);
    event ProtocolFeeAccrued(uint256 indexed marketId, uint256 indexed jobId, uint256 margin);
    event AttributionPaid(uint256 indexed marketId, uint256 indexed jobId, address indexed originator, uint256 amount);
    event PoolReward(uint256 indexed marketId, address indexed originator, uint256 amount);
    event EscrowReleased(uint256 indexed marketId, address indexed to, uint256 amount);
    event StakeLocked(uint256 indexed marketId, address indexed participant, uint256 amount);
    event StakeRefunded(uint256 indexed marketId, address indexed participant, uint256 amount);
    event StakeSlashed(uint256 indexed marketId, address indexed participant, address indexed to, uint256 amount);
    event RevisionWindowOpened(uint256 indexed jobId, uint256 newGhostDeadline);
    event RevisionExtended(uint256 indexed jobId, uint8 extensionCount, uint256 newGhostDeadline);

    error NotAgenticCommerce();
    error NotMarketRegistry();
    error AlreadyWithdrawn();
    error InsufficientEscrow();
    error AlreadySet();
    error JobNotFound();
    error InvalidFee();
    error NotProvider();
    error RevisionAlreadyUsed();
    error WrongTier();
    error RevisionNotOpen();
    error JobNotOpen();
    error MaxExtensions();

    modifier onlyAgenticCommerce() {
        if (msg.sender != address(agenticCommerce)) revert NotAgenticCommerce();
        _;
    }

    modifier onlyRegistry() {
        if (msg.sender != marketRegistry) revert NotMarketRegistry();
        _;
    }

    function initialize(
        address _agenticCommerce,
        address _reputationRegistry,
        address _usdc
    ) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        agenticCommerce = IAgenticCommerce(_agenticCommerce);
        reputationRegistry = IReputationRegistry(_reputationRegistry);
        usdc = IERC20(_usdc);
    }

    function setMarketRegistry(address _marketRegistry) external onlyOwner {
        if (marketRegistry != address(0)) revert AlreadySet();
        if (_marketRegistry == address(0)) revert NotMarketRegistry();
        marketRegistry = _marketRegistry;
        emit RegistrySet(_marketRegistry);
    }

    /// @notice Repoint the AgenticCommerce instance EchoHook trusts for hook callbacks.
    ///         Used to switch between a self-hosted test instance and Arc's canonical
    ///         AgenticCommerce (once Circle whitelists EchoHook). Owner-gated; the new
    ///         address becomes the sole authorized caller of before/afterAction.
    function setAgenticCommerce(address _agenticCommerce) external onlyOwner {
        if (_agenticCommerce == address(0)) revert NotAgenticCommerce();
        agenticCommerce = IAgenticCommerce(_agenticCommerce);
        emit AgenticCommerceSet(_agenticCommerce);
    }

    function initJobContext(uint256 jobId, MarketContext calldata marketCtx) external onlyRegistry {
        ctx[jobId] = marketCtx;
    }

    function setTierAmounts(uint256 marketId, uint256[4] calldata amounts) external onlyRegistry {
        tierAmounts[marketId] = amounts;
    }

    function fundEscrow(uint256 marketId, uint256 amount) external onlyRegistry {
        escrowed[marketId] += amount;
    }

    /// @notice Configure the protocol take-rate and attribution wiring. Until set, protocolFeeBps
    ///         is 0 and completion pays the worker the full amount (legacy behavior).
    function setProtocolConfig(
        uint16 _feeBps,
        address _treasury,
        address _attributionPayout,
        address _attributionRegistry
    ) external onlyOwner {
        if (_feeBps > 10_000) revert InvalidFee();
        protocolFeeBps = _feeBps;
        protocolTreasury = _treasury;
        attributionPayout = AttributionPayout(_attributionPayout);
        attributionRegistry = AttributionRegistry(_attributionRegistry);
        emit ProtocolConfigured(_feeBps, _treasury);
    }

    /// @notice Return escrow to the requester (e.g. on market close). Escrow custody lives here,
    ///         so the refund must originate here — the registry only authorizes it.
    function releaseEscrow(uint256 marketId, address to, uint256 amount) external onlyRegistry {
        if (distributed[marketId] + amount > escrowed[marketId]) revert InsufficientEscrow();
        distributed[marketId] += amount;
        usdc.safeTransfer(to, amount);
        emit EscrowReleased(marketId, to, amount);
    }

    function fundPool(uint256 marketId, uint256 amount, uint16 shareBps) external onlyRegistry {
        poolEscrowed[marketId] += amount;
        poolShareBps[marketId] = shareBps;
    }

    function releasePoolRemainder(uint256 marketId, address to) external onlyRegistry returns (uint256 remaining) {
        remaining = poolEscrowed[marketId] - poolDistributed[marketId];
        if (remaining > 0) {
            poolDistributed[marketId] += remaining;
            usdc.safeTransfer(to, remaining);
        }
    }

    // ──────────────────── Returnable applicant stake (spec §4) ────────────────────

    /// @notice Record a participant's stake. The registry has already transferred the USDC here,
    ///         so this only books the balance. Additive on re-apply (stake scales with engagement).
    function lockStake(uint256 marketId, address participant, uint256 amount) external onlyRegistry {
        stakeBalance[marketId][participant] += amount;
        emit StakeLocked(marketId, participant, amount);
    }

    /// @notice Return a participant's stake in full (good-faith resolution: rejected-on-teaser,
    ///         revealed-and-not-flagged, or market expired unrevealed). Idempotent: zero if none.
    function refundStake(uint256 marketId, address participant) external onlyRegistry returns (uint256 amount) {
        amount = stakeBalance[marketId][participant];
        if (amount > 0) {
            stakeBalance[marketId][participant] = 0;
            usdc.safeTransfer(participant, amount);
            emit StakeRefunded(marketId, participant, amount);
        }
    }

    /// @notice Forfeit a participant's stake to `to` (the harmed party). The condition that
    ///         JUSTIFIES a slash — a sustained bait-and-switch flag or a post-engagement no-show —
    ///         is adjudicated upstream (P5/P6 DisputeResolver); this is the settlement leg. Writes
    ///         the negative P-Rep that a sustained bait verdict earns the applicant (best-effort,
    ///         like every other reputation write — never blocks the slash).
    function slashStake(uint256 marketId, address participant, address to, uint256 participantAgentId)
        external
        onlyRegistry
        returns (uint256 amount)
    {
        amount = stakeBalance[marketId][participant];
        if (amount > 0) {
            stakeBalance[marketId][participant] = 0;
            usdc.safeTransfer(to, amount);
            _feedback(participantAgentId, int128(-1), "bait_sustained", bytes32(0));
            emit StakeSlashed(marketId, participant, to, amount);
        }
    }

    // ──────────────────── ERC-8183 hook (IACPHook) ────────────────────

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public pure override returns (bool) {
        return interfaceId == type(IACPHook).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /// @notice Pre-action hook. Echo settles post-action only, so this is a no-op gate that
    ///         simply asserts the caller is Arc's AgenticCommerce.
    function beforeAction(uint256, bytes4, bytes calldata) external view onlyAgenticCommerce {}

    /// @notice Post-action hook. Arc passes the lifecycle selector (`msg.sig`) and the
    ///         abi-encoded call args. Echo acts on `complete` (settle payout) and `submit`
    ///         (acknowledge in reputation); other transitions need no Echo bookkeeping.
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external onlyAgenticCommerce {
        if (selector == IAgenticCommerce.complete.selector) {
            // complete(uint256,bytes32,bytes) → data = abi.encode(evaluator, reason, optParams)
            (, bytes32 reasonHash, ) = abi.decode(data, (address, bytes32, bytes));
            _settleComplete(jobId, reasonHash);
        } else if (selector == IAgenticCommerce.submit.selector) {
            _ackSubmit(jobId);
        } else if (selector == IAgenticCommerce.requestRevision.selector) {
            _openRevision(jobId);
        }
    }

    // --- Final-tier revision window ---

    uint256 private constant REVISION_BASE = 60 minutes;       // fresh window when revision opens
    uint8 private constant MAX_REVISION_EXTENSIONS = 3;
    /// Decreasing self-extension grants by extensions-already-used: 45m, 30m, 15m.
    function _extGrant(uint8 n) private pure returns (uint256) {
        if (n == 0) return 45 minutes;
        if (n == 1) return 30 minutes;
        return 15 minutes; // n == 2
    }

    /// @notice Reopen the Final-tier revision window (called via afterAction on requestRevision).
    ///         One revision per job; resets the ghost deadline to now + base so the worker gets a fair
    ///         re-submit window. Reverts (bubbling up to revert the AgenticCommerce tx) on misuse.
    function _openRevision(uint256 jobId) internal {
        MarketContext storage c = ctx[jobId];
        if (c.marketId == 0) revert JobNotFound();
        if (c.tier != Tier.Final) revert WrongTier();
        if (revisionUsed[jobId]) revert RevisionAlreadyUsed();
        revisionUsed[jobId] = true;
        c.ghostDeadline = block.timestamp + REVISION_BASE;
        emit RevisionWindowOpened(jobId, c.ghostDeadline);
    }

    /// @notice Worker (the Arc job's provider) self-extends an open revision window, up to
    ///         MAX_REVISION_EXTENSIONS times by a decreasing grant. Only while the Final job is back
    ///         in Open (i.e. revision requested, not yet re-submitted). Pushes out the ghost deadline.
    function extendRevision(uint256 jobId) external {
        MarketContext storage c = ctx[jobId];
        if (c.marketId == 0) revert JobNotFound();
        if (!revisionUsed[jobId]) revert RevisionNotOpen();
        IAgenticCommerce.Job memory job = agenticCommerce.getJob(jobId);
        if (msg.sender != job.provider) revert NotProvider();
        if (job.status != IAgenticCommerce.JobStatus.Open) revert JobNotOpen();
        uint8 n = revisionExtensions[jobId];
        if (n >= MAX_REVISION_EXTENSIONS) revert MaxExtensions();
        c.ghostDeadline += _extGrant(n);
        revisionExtensions[jobId] = n + 1;
        emit RevisionExtended(jobId, n + 1, c.ghostDeadline);
    }

    function _settleComplete(uint256 jobId, bytes32 reasonHash) internal {
        MarketContext storage c = ctx[jobId];
        if (c.marketId == 0) revert JobNotFound();
        IAgenticCommerce.Job memory job = agenticCommerce.getJob(jobId);
        // A worker completing a graded tier job is an active resolution → credit the requester.
        _settle(c.marketId, jobId, job.provider, c.participantAgentId, c.requesterAgentId, c.tier, c.tierAmount, reasonHash, true);
    }

    /// @notice Settle a Mode A reveal synchronously (spec §2.1) — no ERC-8183 job. The reveal is
    ///         an ATOMIC exchange (looking IS the payment trigger), so the reveal fee is paid here
    ///         in the same tx the registry refunds the stake. Runs the identical fee/attribution/
    ///         pool/reputation path as a tier completion, so the AR overlay earns on reveals too
    ///         (the §8 cross-cutting wiring).
    function settleReveal(
        uint256 marketId,
        address worker,
        uint256 participantAgentId,
        uint256 requesterAgentId,
        uint256 gross
    ) external onlyRegistry {
        // A reveal is requester-initiated (they paid R to look), so the requester is credited.
        _settle(marketId, 0, worker, participantAgentId, requesterAgentId, Tier.Substantive, gross, bytes32(0), true);
    }

    /// @notice Settle a Mode B milestone (spec §2.2) — accept or auto-release. Same synchronous
    ///         settlement leg as a reveal (fee skim + AR overlay + reputation), no ERC-8183 job.
    ///         `autoReleased` marks a silence-driven default-resolve: the worker is still credited,
    ///         but the requester earns NO "responded" R-Rep (spec §8 — reputation reflects HOW it
    ///         resolved, not just that it paid).
    function settleMilestone(
        uint256 marketId,
        address worker,
        uint256 workerAgentId,
        uint256 requesterAgentId,
        uint256 amount,
        bool autoReleased
    ) external onlyRegistry {
        _settle(marketId, 0, worker, workerAgentId, requesterAgentId, Tier.Milestone, amount, bytes32(0), !autoReleased);
    }

    /// @notice Settle a Bounty accepted finding (spec §2.3) — pays one of many parallel winners
    ///         from the pool. Same synchronous settlement leg as reveal/milestone (fee skim + AR
    ///         overlay + reputation), no ERC-8183 job. `autoEscalated` marks a silence-driven (or
    ///         dispute-overruled) default-resolve: the submitter is credited, the requester is not.
    function settleFinding(
        uint256 marketId,
        address submitter,
        uint256 submitterAgentId,
        uint256 requesterAgentId,
        uint256 amount,
        bool autoEscalated
    ) external onlyRegistry {
        _settle(marketId, 0, submitter, submitterAgentId, requesterAgentId, Tier.Finding, amount, bytes32(0), !autoEscalated);
    }

    /// @dev Shared settlement leg for both the job-completion path and the reveal path. jobId == 0
    ///      marks a reveal (no underlying Arc job). Pays the worker net of Echo's fee, skims the
    ///      fee (attribution slice + treasury margin), pays the requester pool reward, and writes
    ///      reputation. `creditRequester` is false for silence-driven default-resolves so the
    ///      requester is not vouched for an outcome they didn't actively reach (spec §8).
    function _settle(
        uint256 marketId,
        uint256 jobId,
        address provider,
        uint256 participantAgentId,
        uint256 requesterAgentId,
        Tier tier,
        uint256 gross,
        bytes32 reasonHash,
        bool creditRequester
    ) internal {
        if (distributed[marketId] + gross > escrowed[marketId]) revert InsufficientEscrow();
        distributed[marketId] += gross;

        // Echo's fee is skimmed from the payout; the worker receives the remainder.
        uint256 fee = gross * protocolFeeBps / 10_000;
        uint256 net = gross - fee;

        usdc.safeTransfer(provider, net);

        if (fee > 0) {
            uint256 attributed = _payAttribution(marketId, jobId, participantAgentId, fee);
            uint256 margin = fee - attributed;
            if (margin > 0 && protocolTreasury != address(0)) {
                usdc.safeTransfer(protocolTreasury, margin);
            }
            emit ProtocolFeeAccrued(marketId, jobId, margin);
        }

        // Requester-funded pool rewards the worker's introducer, bounded by the pool balance.
        _payPoolReward(marketId, participantAgentId, gross);

        _writeSettlementReputation(participantAgentId, requesterAgentId, tier, reasonHash, creditRequester);

        emit TierPayout(marketId, jobId, provider, tier, net);
    }

    function _ackSubmit(uint256 jobId) internal {
        MarketContext storage c = ctx[jobId];
        if (c.marketId == 0) revert JobNotFound();
        _feedback(c.participantAgentId, int128(0), "submitted", bytes32(0));
    }

    /// @dev Pay platform ARs out of Echo's fee. Returns the total attributed.
    function _payAttribution(
        uint256 marketId,
        uint256 jobId,
        uint256 workerAgentId,
        uint256 fee
    ) internal returns (uint256 attributed) {
        if (address(attributionPayout) == address(0)) return 0;

        (address[] memory recips, uint256[] memory amts, uint256 totalPaid) =
            attributionPayout.settle(workerAgentId, fee);

        for (uint256 i; i < recips.length; ++i) {
            if (amts[i] > 0) {
                usdc.safeTransfer(recips[i], amts[i]);
                emit AttributionPaid(marketId, jobId, recips[i], amts[i]);
            }
        }
        attributed = totalPaid;
    }

    /// @dev Pay the worker's introducer from the requester's per-market pool.
    function _payPoolReward(uint256 marketId, uint256 workerAgentId, uint256 gross) internal {
        uint16 shareBps = poolShareBps[marketId];
        if (shareBps == 0 || address(attributionRegistry) == address(0)) return;

        uint256 remaining = poolEscrowed[marketId] - poolDistributed[marketId];
        if (remaining == 0) return;

        (address originator, bool exists) = attributionRegistry.primaryIntroducer(workerAgentId);
        if (!exists) return;

        uint256 reward = gross * shareBps / 10_000;
        if (reward > remaining) reward = remaining;
        if (reward == 0) return;

        poolDistributed[marketId] += reward;
        usdc.safeTransfer(originator, reward);
        emit PoolReward(marketId, originator, reward);
    }

    function _writeSettlementReputation(
        uint256 participantAgentId,
        uint256 requesterAgentId,
        Tier tier,
        bytes32 reasonHash,
        bool creditRequester
    ) internal {
        string memory tag;
        if (tier == Tier.Substantive) tag = "tier_substantive";
        else if (tier == Tier.Shortlist) tag = "tier_shortlist";
        else if (tier == Tier.Final) tag = "tier_final";
        else if (tier == Tier.Milestone) tag = "milestone";
        else if (tier == Tier.Finding) tag = "bounty_finding";
        else tag = "tier_unknown";

        // The worker is always vouched for the delivered work. The requester is only vouched when
        // they actively reached this outcome — a silence-driven or dispute-overruled default-resolve
        // pays the worker but earns the requester no "responded" R-Rep (spec §8 neutral-on-silence).
        _feedback(participantAgentId, int128(1), tag, reasonHash);
        if (creditRequester) {
            _feedback(requesterAgentId, int128(1), "responded", reasonHash);
        }
    }

    /// @dev Write a single feedback to Arc's ReputationRegistry as EchoHook (the "client").
    ///      Best-effort: reputation must never block a payout, and giveFeedback reverts on
    ///      unregistered agents / self-feedback — so failures are swallowed.
    function _feedback(uint256 agentId, int128 value, string memory tag, bytes32 hash) internal {
        if (address(reputationRegistry) == address(0) || agentId == 0) return;
        try reputationRegistry.giveFeedback(agentId, value, 0, "echo", tag, "", "", hash) {} catch {}
    }

    /// @notice Echo-native ghost penalty. Arc fires no expiry hook, so MarketRegistry drives this
    ///         once a Final-tier job's ghost deadline passes without completion. Branches on the
    ///         Arc job's current status to assign blame to the actual silent party:
    ///           Submitted   → worker did their part, requester never accepted. Pay the worker the
    ///                         ghost reserve, slash requester R-Rep ("ghosted"). The original
    ///                         worker-protection path.
    ///           Open        → worker never submitted. No USDC moves (ghost reserve stays in escrow
    ///                         and refunds on closeMarket), worker's P-Rep gets -1 "worker_ghosted",
    ///                         requester is untouched. WorkerGhosted emitted instead of GhostPenalty
    ///                         so indexers can distinguish.
    ///           Funded      → treated as Submitted for backward compat (Echo never funds, so this
    ///                         path is unreachable today; conservative default if it ever changes).
    ///           Completed   → no-op (a happy completion already settled via afterAction).
    ///           Rejected/Expired → no-op (terminal states; no further action).
    function triggerGhost(uint256 jobId) external onlyRegistry {
        MarketContext storage c = ctx[jobId];
        if (c.marketId == 0) revert JobNotFound();
        if (c.ghostTriggered) revert AlreadyWithdrawn();
        if (c.tier != Tier.Final || block.timestamp < c.ghostDeadline) return;

        IAgenticCommerce.Job memory job = agenticCommerce.getJob(jobId);
        IAgenticCommerce.JobStatus status = job.status;

        // Worker never delivered → no payout, slash the worker, leave the requester out of it.
        if (status == IAgenticCommerce.JobStatus.Open) {
            c.ghostTriggered = true;
            _feedback(c.participantAgentId, int128(-1), "worker_ghosted", bytes32(0));
            emit WorkerGhosted(c.marketId, jobId, job.provider, c.participantAgentId);
            return;
        }

        // Anything except a Submitted Arc job at deadline is terminal — settle paths already ran or
        // the job is in a no-action terminal state. Bail without touching escrow or reputation.
        if (status != IAgenticCommerce.JobStatus.Submitted && status != IAgenticCommerce.JobStatus.Funded) {
            return;
        }

        // Worker submitted but the requester never accepted → original requester-ghost path.
        uint256 ghostAmount = tierAmounts[c.marketId][3];
        if (distributed[c.marketId] + ghostAmount > escrowed[c.marketId]) revert InsufficientEscrow();

        distributed[c.marketId] += ghostAmount;
        c.ghostTriggered = true;

        usdc.safeTransfer(job.provider, ghostAmount);

        _feedback(c.requesterAgentId, int128(-1), "ghosted", bytes32(0));
        _feedback(c.participantAgentId, int128(1), "ghosted_victim", bytes32(0));

        emit GhostPenalty(c.marketId, jobId, job.provider, ghostAmount, job.client);
        emit RRepSlashed(c.requesterAgentId, c.marketId, ghostAmount);
    }

    function getTierAmount(uint256 marketId, uint8 tierIndex) external view returns (uint256) {
        return tierAmounts[marketId][tierIndex];
    }

    function remainingEscrow(uint256 marketId) external view returns (uint256) {
        return escrowed[marketId] - distributed[marketId];
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
