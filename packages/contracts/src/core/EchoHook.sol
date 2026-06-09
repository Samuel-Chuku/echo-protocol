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
        Ghost
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
    event RegistrySet(address indexed registry);
    event ProtocolConfigured(uint16 feeBps, address treasury);
    event ProtocolFeeAccrued(uint256 indexed marketId, uint256 indexed jobId, uint256 margin);
    event AttributionPaid(uint256 indexed marketId, uint256 indexed jobId, address indexed originator, uint256 amount);
    event PoolReward(uint256 indexed marketId, address indexed originator, uint256 amount);
    event EscrowReleased(uint256 indexed marketId, address indexed to, uint256 amount);

    error NotAgenticCommerce();
    error NotMarketRegistry();
    error AlreadyWithdrawn();
    error InsufficientEscrow();
    error AlreadySet();
    error JobNotFound();
    error InvalidFee();

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
        }
    }

    function _settleComplete(uint256 jobId, bytes32 reasonHash) internal {
        MarketContext storage c = ctx[jobId];
        if (c.marketId == 0) revert JobNotFound();

        uint256 gross = c.tierAmount;
        if (distributed[c.marketId] + gross > escrowed[c.marketId]) revert InsufficientEscrow();
        distributed[c.marketId] += gross;

        IAgenticCommerce.Job memory job = agenticCommerce.getJob(jobId);

        // Echo's fee is skimmed from the payout; the worker receives the remainder.
        uint256 fee = gross * protocolFeeBps / 10_000;
        uint256 net = gross - fee;

        usdc.safeTransfer(job.provider, net);

        if (fee > 0) {
            uint256 attributed = _payAttribution(c.marketId, jobId, c.participantAgentId, fee);
            uint256 margin = fee - attributed;
            if (margin > 0 && protocolTreasury != address(0)) {
                usdc.safeTransfer(protocolTreasury, margin);
            }
            emit ProtocolFeeAccrued(c.marketId, jobId, margin);
        }

        // Requester-funded pool rewards the worker's introducer, bounded by the pool balance.
        _payPoolReward(c.marketId, c.participantAgentId, gross);

        _writeCompletionReputation(c, reasonHash);

        emit TierPayout(c.marketId, jobId, job.provider, c.tier, net);
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

    function _writeCompletionReputation(MarketContext storage c, bytes32 reasonHash) internal {
        string memory tag;
        if (c.tier == Tier.Substantive) tag = "tier_substantive";
        else if (c.tier == Tier.Shortlist) tag = "tier_shortlist";
        else if (c.tier == Tier.Final) tag = "tier_final";
        else tag = "tier_unknown";

        // Echo vouches (as its own client identity) for both sides of a completed tier.
        _feedback(c.participantAgentId, int128(1), tag, reasonHash);
        _feedback(c.requesterAgentId, int128(1), "responded", reasonHash);
    }

    /// @dev Write a single feedback to Arc's ReputationRegistry as EchoHook (the "client").
    ///      Best-effort: reputation must never block a payout, and giveFeedback reverts on
    ///      unregistered agents / self-feedback — so failures are swallowed.
    function _feedback(uint256 agentId, int128 value, string memory tag, bytes32 hash) internal {
        if (address(reputationRegistry) == address(0) || agentId == 0) return;
        try reputationRegistry.giveFeedback(agentId, value, 0, "echo", tag, "", "", hash) {} catch {}
    }

    /// @notice Echo-native ghost penalty. Arc fires no expiry hook, so MarketRegistry drives
    ///         this once a Final-tier job's ghost deadline passes without completion.
    function triggerGhost(uint256 jobId) external onlyRegistry {
        MarketContext storage c = ctx[jobId];
        if (c.marketId == 0) revert JobNotFound();
        if (c.ghostTriggered) revert AlreadyWithdrawn();
        if (c.tier != Tier.Final || block.timestamp < c.ghostDeadline) return;

        uint256 ghostAmount = tierAmounts[c.marketId][3];
        if (distributed[c.marketId] + ghostAmount > escrowed[c.marketId]) revert InsufficientEscrow();

        distributed[c.marketId] += ghostAmount;
        c.ghostTriggered = true;

        IAgenticCommerce.Job memory job = agenticCommerce.getJob(jobId);
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
