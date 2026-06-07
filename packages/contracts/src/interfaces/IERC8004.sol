// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IIdentityRegistry (ERC-8004)
 * @notice Arc's deployed identity registry. One NFT = one agent identity.
 * @dev Address on Arc Testnet: 0x8004A818BFB912233c491871b3d84c89A494BD9e
 */
interface IIdentityRegistry {
    function register(string calldata metadataURI) external returns (uint256 agentId);
    function agentOf(uint256 agentId) external view returns (address owner);
    function isRegistered(address user) external view returns (bool);
    function agentIdOf(address user) external view returns (uint256);
}

/**
 * @title IReputationRegistry (ERC-8004)
 * @notice Arc's deployed reputation registry. Attestations from external observers.
 *         Critical anti-self-dealing: owners cannot record rep for their own agents.
 * @dev Address on Arc Testnet: 0x8004B663056A597Dffe9eCcC1965A193B7388713
 */
interface IReputationRegistry {
    function acceptFeedback(
        uint256 agentId,
        uint256 counterpartyId,
        string calldata feedbackType,
        bytes32 metadata
    ) external;

    function getFeedbackCount(uint256 agentId) external view returns (uint256);
    function getFeedback(uint256 agentId, uint256 index) external view returns (
        uint256 counterpartyId,
        string memory feedbackType,
        bytes32 metadata,
        uint256 timestamp
    );
}

/**
 * @title IValidationRegistry (ERC-8004)
 * @notice Verifies external credentials cryptographically.
 * @dev Address on Arc Testnet: 0x8004Cb1BF31DAf7788923b405b754f57acEB4272
 */
interface IValidationRegistry {
    function validate(bytes32 credentialType, bytes calldata proof) external returns (bool);
    function isValidated(uint256 agentId, bytes32 credentialType) external view returns (bool);
}
