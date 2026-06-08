// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IAgenticCommerce} from "../../interfaces/IERC8183.sol";

/// @notice 6-decimal ERC20 standing in for Arc native USDC.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Minimal ERC-8004 IdentityRegistry stand-in. agentIdOf returns a preset id.
contract MockIdentityRegistry {
    mapping(address => uint256) public ids;
    uint256 public next = 1;

    function setAgent(address user, uint256 id) external {
        ids[user] = id;
    }

    function register(string calldata) external returns (uint256 agentId) {
        agentId = next++;
        ids[msg.sender] = agentId;
    }

    function agentIdOf(address user) external view returns (uint256) {
        return ids[user];
    }

    function isRegistered(address user) external view returns (bool) {
        return ids[user] != 0;
    }

    function agentOf(uint256) external pure returns (address) {
        return address(0);
    }
}

/// @notice No-op ERC-8004 ReputationRegistry — records nothing, just accepts calls.
contract MockReputationRegistry {
    event Feedback(uint256 agentId, uint256 counterpartyId, string feedbackType, bytes32 metadata);

    function acceptFeedback(uint256 a, uint256 b, string calldata t, bytes32 m) external {
        emit Feedback(a, b, t, m);
    }

    function getFeedbackCount(uint256) external pure returns (uint256) {
        return 0;
    }
}

/// @notice ERC-8183 AgenticCommerce stand-in that stores jobs and fires hook callbacks,
///         so MarketRegistry → EchoHook lifecycle can be driven end-to-end in tests.
contract MockAgenticCommerce {
    IAgenticCommerce.Job[] private _jobs; // 1-indexed via +1 offset
    uint256 public jobCount;

    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        bytes32 description,
        address hook
    ) external returns (uint256 jobId) {
        _jobs.push(IAgenticCommerce.Job({
            client: msg.sender,
            provider: provider,
            evaluator: evaluator,
            budget: 0,
            expiredAt: expiredAt,
            description: description,
            status: IAgenticCommerce.JobStatus.Active,
            hook: hook
        }));
        jobId = ++jobCount;
    }

    function jobs(uint256 jobId) external view returns (IAgenticCommerce.Job memory) {
        return _jobs[jobId - 1];
    }

    /// @dev Test driver: simulate the evaluator completing a job, firing the hook.
    function complete(uint256 jobId, bytes32 reasonHash) external {
        IAgenticCommerce.Job storage j = _jobs[jobId - 1];
        j.status = IAgenticCommerce.JobStatus.Completed;
        IEchoHookCallback(j.hook).onComplete(jobId, reasonHash);
    }

    /// @dev Test driver: simulate expiry, firing the hook.
    function expire(uint256 jobId) external {
        IEchoHookCallback(_jobs[jobId - 1].hook).onExpire(jobId);
    }
}

interface IEchoHookCallback {
    function onComplete(uint256 jobId, bytes32 reasonHash) external;
    function onExpire(uint256 jobId) external;
}
