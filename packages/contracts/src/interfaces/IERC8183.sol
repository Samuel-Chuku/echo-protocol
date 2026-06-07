// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgenticCommerce {
    enum JobStatus {
        Pending,
        Active,
        Submitted,
        Disputed,
        Completed,
        Expired
    }

    struct Job {
        address client;
        address provider;
        address evaluator;
        uint256 budget;
        uint256 expiredAt;
        bytes32 description;
        JobStatus status;
        address hook;
    }

    /// @notice Create a new job with lifecycle hook support
    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        bytes32 description,
        address hook
    ) external returns (uint256 jobId);

    /// @notice Fund a job with USDC
    function fundJob(uint256 jobId) external;

    /// @notice Provider submits deliverable
    function submit(uint256 jobId, bytes32 deliverableHash) external;

    /// @notice Evaluator completes the job (triggers hook)
    function complete(uint256 jobId, bytes32 reasonHash) external;

    /// @notice Anyone can expire a job after deadline (triggers hook)
    function expire(uint256 jobId) external;

    /// @notice Get job details
    function jobs(uint256 jobId) external view returns (Job memory);

    /// @notice Check if hook callback is registered
    function supportsHook(address hook) external view returns (bool);

    /// @dev Events
    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        address evaluator,
        uint256 expiredAt,
        bytes32 description,
        address hook
    );
    event JobFunded(uint256 indexed jobId, address indexed funder, uint256 amount);
    event JobSubmitted(uint256 indexed jobId, bytes32 deliverableHash);
    event JobCompleted(uint256 indexed jobId, bytes32 reasonHash);
    event JobExpired(uint256 indexed jobId);
}
