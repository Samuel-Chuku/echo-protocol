// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAgenticCommerce} from "../interfaces/IERC8183.sol";
import {IReputationRegistry} from "../interfaces/IERC8004.sol";

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

    error NotAgenticCommerce();
    error NotMarketRegistry();
    error AlreadyWithdrawn();
    error InsufficientEscrow();
    error AlreadySet();
    error JobNotFound();

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

        uint256 amount = c.tierAmount;
        if (distributed[c.marketId] + amount > escrowed[c.marketId]) revert InsufficientEscrow();

        distributed[c.marketId] += amount;

        IAgenticCommerce.Job memory job = agenticCommerce.jobs(jobId);
        usdc.safeTransfer(job.provider, amount);

        string memory feedbackType;
        if (c.tier == Tier.Substantive) feedbackType = "tier_substantive";
        else if (c.tier == Tier.Shortlist) feedbackType = "tier_shortlist";
        else if (c.tier == Tier.Final) feedbackType = "tier_final";
        else feedbackType = "tier_unknown";

        reputationRegistry.acceptFeedback(c.participantAgentId, c.requesterAgentId, feedbackType, reasonHash);
        reputationRegistry.acceptFeedback(c.requesterAgentId, c.participantAgentId, "responded", reasonHash);

        emit TierPayout(c.marketId, jobId, job.provider, c.tier, amount);
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
