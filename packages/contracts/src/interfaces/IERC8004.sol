// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IIdentityRegistry (ERC-8004)
 * @notice Arc's deployed identity registry. One NFT = one agent identity.
 *         Verified live surface (impl 0x7274e874ca62410a93bd8bf61c69d8045e399c02):
 *         it is an ERC-721 — there is NO `agentIdOf(address)` reverse lookup and it
 *         is NOT ERC721Enumerable. Agents are referenced by their tokenId (= agentId),
 *         which the holder knows from `register()`. Callers must thread the agentId in.
 * @dev Address on Arc Testnet: 0x8004A818BFB912233c491871b3d84c89A494BD9e
 */
interface IIdentityRegistry {
    /// @notice Mint a fresh agent identity to msg.sender. Returns the new agentId (tokenId).
    function register() external returns (uint256 agentId);
    /// @notice Mint an agent identity with a metadata/token URI.
    function register(string calldata uri) external returns (uint256 agentId);

    /// @notice ERC-721 owner of an agent identity.
    function ownerOf(uint256 agentId) external view returns (address);
    /// @notice The wallet authorized to act for an agent (may differ from owner).
    function getAgentWallet(uint256 agentId) external view returns (address);
    /// @notice Number of agent identities held by `owner`.
    function balanceOf(address owner) external view returns (uint256);
    /// @notice True if `spender` is the owner, approved, or the registered agent wallet.
    ///         The canonical "does this address control this agentId" check.
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);
    /// @notice Per-agent token URI.
    function tokenURI(uint256 agentId) external view returns (string memory);

    function setAgentWallet(uint256 agentId, address wallet, uint256 deadline, bytes calldata sig) external;
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

/**
 * @title IReputationRegistry (ERC-8004)
 * @notice Arc's deployed reputation registry. Verified live surface
 *         (impl 0x16e0fa7f7c56b9a767e34b192b51f921be31da34).
 *
 *         Feedback is keyed by (agentId, msg.sender=client, index). `giveFeedback` is
 *         PERMISSIONLESS — the only gate is anti-self-dealing: the caller must NOT be
 *         authorized/owner of `agentId` ("Self-feedback not allowed"). It also reverts
 *         with ERC721NonexistentToken if `agentId` was never registered. Echo writes
 *         feedback as its own client identity (the EchoHook address).
 * @dev Address on Arc Testnet: 0x8004B663056A597Dffe9eCcC1965A193B7388713
 */
interface IReputationRegistry {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;

    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external;

    function getSummary(
        uint256 agentId,
        address[] calldata clients,
        string calldata tag1,
        string calldata tag2
    ) external view returns (uint64 count, int128 aggregateValue, uint8 valueDecimals);

    function readFeedback(
        uint256 agentId,
        address client,
        uint64 index
    ) external view returns (
        int128 value,
        uint8 valueDecimals,
        string memory endpoint,
        string memory feedbackURI,
        bool isRevoked
    );
}

/**
 * @title IValidationRegistry (ERC-8004)
 * @notice Verifies external credentials cryptographically. Not consumed by Echo yet;
 *         kept for completeness. Re-verify against the live ABI before integrating.
 * @dev Address on Arc Testnet: 0x8004Cb1BF31DAf7788923b405b754f57acEB4272
 */
interface IValidationRegistry {
    function isValidated(uint256 agentId, bytes32 credentialType) external view returns (bool);
}
