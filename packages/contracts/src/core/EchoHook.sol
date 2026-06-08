// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAgenticCommerce} from "../interfaces/IERC8183.sol";
import {IReputationRegistry} from "../interfaces/IERC8004.sol";
import {AttributionPayout} from "./AttributionPayout.sol";
import {AttributionRegistry} from "./AttributionRegistry.sol";

/**
 * @title EchoHook
 * @notice Upgradeable. The heart of Echo Protocol. Implements hook callbacks for
 *         every ERC-8183 job lifecycle transition. Handles tier payouts, ghost penalties,
 *         and writes P-Rep / R-Rep / G-Rep events to Arc's ReputationRegistry.
 * @dev Uses UUPS proxy pattern for upgradeability.
 */
contract EchoHook is Initializable, OwnableUpgradeable, UUPSUpgradeable {
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
    ///         is 0 and onComplete pays the worker the full amount (legacy behavior).
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

    function onFund(uint256, address, uint256) external onlyAgenticCommerce {
        // No-op: MarketRegistry handles escrow pool funding
    }

    function onSubmit(uint256 jobId, bytes32) external onlyAgenticCommerce {
        MarketContext storage c = ctx[jobId];
        if (c.marketId == 0) revert JobNotFound();

        reputationRegistry.acceptFeedback(
            c.participantAgentId, c.requesterAgentId, "submitted", bytes32(0)
        );
    }

    function onComplete(uint256 jobId, bytes32 reasonHash) external onlyAgenticCommerce {
        MarketContext storage c = ctx[jobId];
        if (c.marketId == 0) revert JobNotFound();

        uint256 gross = c.tierAmount;
        if (distributed[c.marketId] + gross > escrowed[c.marketId]) revert InsufficientEscrow();
        distributed[c.marketId] += gross;

        IAgenticCommerce.Job memory job = agenticCommerce.jobs(jobId);

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
        string memory feedbackType;
        if (c.tier == Tier.Substantive) feedbackType = "tier_substantive";
        else if (c.tier == Tier.Shortlist) feedbackType = "tier_shortlist";
        else if (c.tier == Tier.Final) feedbackType = "tier_final";
        else feedbackType = "tier_unknown";

        reputationRegistry.acceptFeedback(c.participantAgentId, c.requesterAgentId, feedbackType, reasonHash);
        reputationRegistry.acceptFeedback(c.requesterAgentId, c.participantAgentId, "responded", reasonHash);
    }

    function onExpire(uint256 jobId) external onlyAgenticCommerce {
        MarketContext storage c = ctx[jobId];
        if (c.marketId == 0) revert JobNotFound();
        if (c.ghostTriggered) revert AlreadyWithdrawn();

        if (c.tier == Tier.Final && block.timestamp >= c.ghostDeadline) {
            uint256 ghostAmount = tierAmounts[c.marketId][3];

            if (distributed[c.marketId] + ghostAmount > escrowed[c.marketId])
                revert InsufficientEscrow();

            distributed[c.marketId] += ghostAmount;
            c.ghostTriggered = true;

            IAgenticCommerce.Job memory job = agenticCommerce.jobs(jobId);
            usdc.safeTransfer(job.provider, ghostAmount);

            reputationRegistry.acceptFeedback(c.requesterAgentId, c.participantAgentId, "ghosted", bytes32(0));
            reputationRegistry.acceptFeedback(c.participantAgentId, c.requesterAgentId, "ghosted_victim", bytes32(0));

            emit GhostPenalty(c.marketId, jobId, job.provider, ghostAmount, job.client);
            emit RRepSlashed(c.requesterAgentId, c.marketId, ghostAmount);
        }
    }

    function getTierAmount(uint256 marketId, uint8 tierIndex) external view returns (uint256) {
        return tierAmounts[marketId][tierIndex];
    }

    function remainingEscrow(uint256 marketId) external view returns (uint256) {
        return escrowed[marketId] - distributed[marketId];
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
