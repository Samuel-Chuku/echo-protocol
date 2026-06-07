// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";

/**
 * @title ParticipationReceipt
 * @notice Upgradeable ERC-721 token proving a participant entered an Echo market.
 *         Non-transferable by default (soulbound). Only MarketRegistry can mint,
 *         advance tiers, or burn.
 * @dev Uses UUPS proxy pattern. Inherits all standard ERC-721 functions from OZ.
 */
contract ParticipationReceipt is Initializable, ERC721Upgradeable, OwnableUpgradeable, UUPSUpgradeable {

    struct Receipt {
        uint256 marketId;
        address participant;
        bytes32 submissionHash;
        uint48 timestamp;
        uint8 tierReached;
        uint256 totalEarned;
        bool withdrawn;
    }

    uint256 public totalSupply;
    mapping(uint256 => Receipt) public receipts;
    address public marketRegistry;

    event ReceiptMinted(
        uint256 indexed tokenId,
        uint256 indexed marketId,
        address indexed participant,
        bytes32 submissionHash
    );
    event TierAdvanced(
        uint256 indexed tokenId,
        uint8 oldTier,
        uint8 newTier,
        uint256 amountEarned
    );
    event ReceiptBurned(uint256 indexed tokenId);
    event MarketRegistrySet(address indexed registry);

    error NotMarketRegistry();
    error RecipientIsZero();
    error ReceiptLocked();
    error InvalidTier();
    error AlreadySet();

    modifier onlyRegistry() {
        if (msg.sender != marketRegistry) revert NotMarketRegistry();
        _;
    }

    function initialize() public initializer {
        __ERC721_init("Echo Participation Receipt", "ECHO-PR");
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function setMarketRegistry(address _marketRegistry) external onlyOwner {
        if (marketRegistry != address(0)) revert AlreadySet();
        if (_marketRegistry == address(0)) revert RecipientIsZero();
        marketRegistry = _marketRegistry;
        emit MarketRegistrySet(_marketRegistry);
    }

    function mint(address to, uint256 marketId, bytes32 submissionHash) external onlyRegistry returns (uint256 tokenId) {
        if (to == address(0)) revert RecipientIsZero();

        tokenId = ++totalSupply;
        _mint(to, tokenId);

        receipts[tokenId] = Receipt({
            marketId: marketId,
            participant: to,
            submissionHash: submissionHash,
            timestamp: uint48(block.timestamp),
            tierReached: 0,
            totalEarned: 0,
            withdrawn: false
        });

        emit ReceiptMinted(tokenId, marketId, to, submissionHash);
    }

    function advanceTier(uint256 tokenId, uint8 newTier, uint256 amountEarned) external onlyRegistry {
        Receipt storage r = receipts[tokenId];
        if (newTier <= r.tierReached || newTier > 3) revert InvalidTier();

        uint8 oldTier = r.tierReached;
        r.tierReached = newTier;
        r.totalEarned += amountEarned;

        emit TierAdvanced(tokenId, oldTier, newTier, amountEarned);
    }

    function markWithdrawn(uint256 tokenId) external onlyRegistry {
        receipts[tokenId].withdrawn = true;
    }

    function burn(uint256 tokenId) external onlyRegistry {
        _burn(tokenId);
        delete receipts[tokenId];
        emit ReceiptBurned(tokenId);
    }

    /**
     * @dev Override OZ v5 _update to make tokens non-transferable (soulbound).
     *      Mint (from == 0) and burn (to == 0) are allowed. Transfers between
     *      addresses are blocked.
     */
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert ReceiptLocked();
        return super._update(to, tokenId, auth);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
