// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IAgenticCommerce} from "../../interfaces/IERC8183.sol";
import {IACPHook} from "../../interfaces/IACPHook.sol";

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

/// @notice Minimal ERC-8004 IdentityRegistry stand-in mirroring the live ERC-721 surface:
///         no address→agentId reverse lookup. `isAuthorizedOrOwner` is the gate Echo uses.
contract MockIdentityRegistry {
    mapping(address => uint256) public ids;    // address → its agentId (test convenience)
    mapping(uint256 => address) public owners; // agentId → owner
    uint256 public next = 1;

    /// @dev Test helper: bind an address to a fixed agentId.
    function setAgent(address user, uint256 id) external {
        ids[user] = id;
        owners[id] = user;
    }

    function register(string calldata) external returns (uint256 agentId) {
        agentId = next++;
        ids[msg.sender] = agentId;
        owners[agentId] = msg.sender;
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        return owners[agentId];
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return owners[agentId];
    }

    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool) {
        return owners[agentId] == spender;
    }

    function balanceOf(address user) external view returns (uint256) {
        return ids[user] == 0 ? 0 : 1;
    }
}

/// @notice No-op ERC-8004 ReputationRegistry — mirrors the live `giveFeedback` signature
///         and just emits, so EchoHook's best-effort reputation writes succeed in tests.
contract MockReputationRegistry {
    event Feedback(uint256 indexed agentId, int128 value, string tag1, string tag2, bytes32 feedbackHash);

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8,
        string calldata tag1,
        string calldata tag2,
        string calldata,
        string calldata,
        bytes32 feedbackHash
    ) external {
        emit Feedback(agentId, value, tag1, tag2, feedbackHash);
    }
}

/// @notice ERC-8183 AgenticCommerce stand-in that stores jobs and fires the IACPHook
///         `afterAction` callback (matching live Arc), so MarketRegistry → EchoHook can be
///         driven end-to-end in tests. Jobs carry no budget — Echo settles from its escrow.
contract MockAgenticCommerce {
    IAgenticCommerce.Job[] private _jobs; // 1-indexed via +1 offset
    uint256 public jobCount;
    mapping(address => bool) public whitelistedHooks;

    function setHookWhitelist(address hook, bool status) external {
        whitelistedHooks[hook] = status;
    }

    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external returns (uint256 jobId) {
        jobId = ++jobCount;
        _jobs.push(IAgenticCommerce.Job({
            id: jobId,
            client: msg.sender,
            provider: provider,
            evaluator: evaluator,
            description: description,
            budget: 0,
            expiredAt: expiredAt,
            status: IAgenticCommerce.JobStatus.Open,
            hook: hook
        }));
        if (hook != address(0)) {
            IACPHook(hook).afterAction(
                jobId, IAgenticCommerce.createJob.selector, abi.encode(msg.sender, provider, evaluator)
            );
        }
    }

    function jobCounter() external view returns (uint256) {
        return jobCount;
    }

    function getJob(uint256 jobId) external view returns (IAgenticCommerce.Job memory) {
        return _jobs[jobId - 1];
    }

    /// @dev Test driver: provider submits a deliverable, firing the submit hook.
    function submit(uint256 jobId, bytes32 deliverable) external {
        IAgenticCommerce.Job storage j = _jobs[jobId - 1];
        j.status = IAgenticCommerce.JobStatus.Submitted;
        if (j.hook != address(0)) {
            IACPHook(j.hook).afterAction(
                jobId, IAgenticCommerce.submit.selector, abi.encode(j.provider, deliverable, bytes(""))
            );
        }
    }

    /// @dev Test driver: evaluator completes, firing the settlement hook.
    function complete(uint256 jobId, bytes32 reasonHash) external {
        IAgenticCommerce.Job storage j = _jobs[jobId - 1];
        j.status = IAgenticCommerce.JobStatus.Completed;
        if (j.hook != address(0)) {
            IACPHook(j.hook).afterAction(
                jobId, IAgenticCommerce.complete.selector, abi.encode(j.evaluator, reasonHash, bytes(""))
            );
        }
    }

    /// @dev Test driver: evaluator rejects a submitted job, firing the reject hook. EchoHook no-ops on
    ///      the reject selector (matching prod) — the tier escrow stays put until close or a dispute.
    function reject(uint256 jobId, bytes32 reason) external {
        IAgenticCommerce.Job storage j = _jobs[jobId - 1];
        j.status = IAgenticCommerce.JobStatus.Rejected;
        if (j.hook != address(0)) {
            IACPHook(j.hook).afterAction(
                jobId, IAgenticCommerce.reject.selector, abi.encode(j.client, reason, bytes(""))
            );
        }
    }
}
