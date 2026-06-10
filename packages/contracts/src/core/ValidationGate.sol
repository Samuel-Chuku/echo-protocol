// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IIdentityRegistry} from "../interfaces/IERC8004.sol";
import {IValidationGate} from "../interfaces/IValidationGate.sol";

/**
 * @title ValidationGate
 * @notice Echo's pluggable genesis filter (spec §3). Separates the two questions a brand-new
 *         build must keep apart: VALIDATION ("are you real?", answerable at zero reputation —
 *         this contract) vs REPUTATION ("are you good?", compounds over time — never the entry
 *         gate). A requester picks which proofs their market accepts; the gate decides whether an
 *         applicant satisfies them.
 *
 *         Proofs are a bitmask. `PROOF_IDENTITY` (controlling the ERC-8004 NFT) is always
 *         required and is the only proof a genesis newcomer needs. The stronger proof-types
 *         (proof-of-personhood / KYC) are reserved bits, satisfied via `attestedProofs` once an
 *         owner-authorized attester wires them in — so World ID / KYC drop in as proof-types,
 *         not a rewrite (spec §7). v1 ships with NO attesters configured, so in practice only
 *         identity-ownership is enforceable today; that is the intended v1 surface.
 *
 *         Kept as a lean sibling (not folded into MarketRegistry) per the spec's "keep proxies
 *         lean" rule. NOT wired to Arc's ERC-8004 ValidationRegistry yet — that anchor's live
 *         ABI is unverified, so it is a parked drop-in (P5).
 * @dev UUPS upgradeable, mirroring the other Echo siblings.
 */
contract ValidationGate is Initializable, OwnableUpgradeable, UUPSUpgradeable, IValidationGate {
    /// @notice The always-required, always-available genesis proof: control of the ERC-8004 NFT.
    uint256 public constant PROOF_IDENTITY = 1 << 0;
    /// @notice Reserved, interface-ready proof-types (inert until an attester populates them).
    uint256 public constant PROOF_GITHUB = 1 << 1;
    uint256 public constant PROOF_PERSONHOOD = 1 << 2; // e.g. World ID
    uint256 public constant PROOF_KYC = 1 << 3;

    IIdentityRegistry public identityRegistry;

    /// @notice agentId => bitmask of proofs attested for it (identity bit is implicit, not stored).
    mapping(uint256 => uint256) public attestedProofs;
    /// @notice Addresses allowed to attest proofs (World ID / KYC adapters slot in here later).
    mapping(address => bool) public attesters;

    event AttesterSet(address indexed attester, bool allowed);
    event ProofsAttested(uint256 indexed agentId, uint256 addedProofs, uint256 totalProofs);

    error ZeroAddress();
    error NotAttester();

    modifier onlyAttester() {
        if (!attesters[msg.sender]) revert NotAttester();
        _;
    }

    function initialize(address _identityRegistry) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        if (_identityRegistry == address(0)) revert ZeroAddress();
        identityRegistry = IIdentityRegistry(_identityRegistry);
    }

    /// @notice Authorize/deauthorize an attester (the parked World ID / KYC adapters).
    function setAttester(address attester, bool allowed) external onlyOwner {
        if (attester == address(0)) revert ZeroAddress();
        attesters[attester] = allowed;
        emit AttesterSet(attester, allowed);
    }

    /// @notice Record that `agentId` has satisfied the given proof bits. Additive (bits OR in).
    ///         Inert in v1 (no attesters set); the drop-in slot for stronger proof-types.
    function attest(uint256 agentId, uint256 proofBits) external onlyAttester {
        uint256 updated = attestedProofs[agentId] | proofBits;
        attestedProofs[agentId] = updated;
        emit ProofsAttested(agentId, proofBits, updated);
    }

    /// @inheritdoc IValidationGate
    /// @dev True iff the applicant controls the identity AND every non-identity proof the market
    ///      requires is attested. Pure view: never mutates, never reverts — the caller decides.
    function validate(uint256 agentId, address applicant, uint256 requiredProofs)
        external
        view
        returns (bool)
    {
        // Identity ownership is mandatory regardless of what the requester asked for.
        if (!identityRegistry.isAuthorizedOrOwner(applicant, agentId)) return false;

        // Every non-identity proof the market requires must be attested for this agent.
        uint256 nonIdentityRequired = requiredProofs & ~PROOF_IDENTITY;
        if (nonIdentityRequired & attestedProofs[agentId] != nonIdentityRequired) return false;

        return true;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
