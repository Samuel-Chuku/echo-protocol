// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAgenticCommerce (ERC-8183)
 * @notice Arc's deployed AgenticCommerce. Verified live surface
 *         (impl 0xa316fd02827242d537f84730f8a37d0ba5fd351a), matching the EIP-8183
 *         reference implementation.
 *
 *         Lifecycle: createJob → (setProvider) → setBudget → fund → submit → complete
 *         (or reject / claimRefund on expiry). The contract custodies `budget` and, on
 *         complete, itself splits platformFee/evaluatorFee/net to treasury/evaluator/
 *         provider. Echo creates jobs with budget == 0 and settles its own tiered payouts
 *         from EchoHook's escrow, so AgenticCommerce moves no money for Echo jobs.
 *
 *         Hooks: every lifecycle transition fires `IACPHook.beforeAction` /
 *         `afterAction(jobId, msg.sig, data)` on the job's hook. There is NO expiry
 *         callback — `claimRefund` does not call the hook — so Echo's ghost path must be
 *         driven natively (see EchoHook.triggerGhost / MarketRegistry).
 * @dev Address on Arc Testnet: 0x0747EEf0706327138c69792bF28Cd525089e4583
 */
interface IAgenticCommerce {
    enum JobStatus {
        Open,       // 0
        Funded,     // 1
        Submitted,  // 2
        Completed,  // 3
        Rejected,   // 4
        Expired     // 5
    }

    struct Job {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        string description;
        uint256 budget;
        uint256 expiredAt;
        JobStatus status;
        address hook;
    }

    /// @notice Create a job. `hook` must be whitelisted by Arc admins and implement IACPHook.
    ///         Fires afterAction(jobId, createJob.selector, abi.encode(client, provider, evaluator)).
    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external returns (uint256 jobId);

    /// @notice Client assigns the provider if not set at creation.
    function setProvider(uint256 jobId, address provider) external;
    /// @notice Provider sets the job budget. Fires before/afterAction with
    ///         abi.encode(msg.sender, amount, optParams).
    function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams) external;
    /// @notice Client funds the job (pulls `budget` USDC if > 0). Fires before/afterAction
    ///         with abi.encode(msg.sender, optParams).
    function fund(uint256 jobId, bytes calldata optParams) external;
    /// @notice Provider submits a deliverable. Fires before/afterAction with
    ///         abi.encode(msg.sender, deliverable, optParams).
    function submit(uint256 jobId, bytes32 deliverable, bytes calldata optParams) external;
    /// @notice Evaluator accepts and releases payment. Fires before/afterAction with
    ///         abi.encode(msg.sender, reason, optParams).
    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external;
    /// @notice Reject (client pre-fund, or evaluator post-fund → refunds budget). Fires
    ///         before/afterAction with abi.encode(msg.sender, reason, optParams).
    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external;
    /// @notice Evaluator sends a Submitted job back for revision: flips it to Open so the provider
    ///         can re-submit. Fires before/afterAction with abi.encode(msg.sender, optParams).
    function requestRevision(uint256 jobId, bytes calldata optParams) external;
    /// @notice Client reclaims budget after expiry. Does NOT call the hook.
    function claimRefund(uint256 jobId) external;

    /// @notice Read a job as a struct.
    function getJob(uint256 jobId) external view returns (Job memory);
    function jobCounter() external view returns (uint256);

    function whitelistedHooks(address hook) external view returns (bool);
    function setHookWhitelist(address hook, bool status) external;

    function paymentToken() external view returns (address);
    function platformFeeBP() external view returns (uint256);
    function evaluatorFeeBP() external view returns (uint256);
    function platformTreasury() external view returns (address);

    event JobCreated(
        uint256 indexed jobId, address indexed client, address indexed provider,
        address evaluator, uint256 expiredAt, address hook
    );
    event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable);
    event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason);
    event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason);
    event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
}
