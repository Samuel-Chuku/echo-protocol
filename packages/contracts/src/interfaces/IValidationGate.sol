// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IValidationGate
 * @notice Echo's pluggable genesis filter. Answers "is this applicant allowed to enter this
 *         market?" using SYBIL-RESISTANCE (are you real?), never REPUTATION (are you good?) —
 *         so a zero-reputation newcomer can still apply on day one (spec §3).
 *
 *         `requiredProofs` is a bitmask the requester chooses per market; the gate decides
 *         whether `applicant` (controlling ERC-8004 `agentId`) satisfies it. v1 enforces
 *         identity-ownership + a requester-chosen accepted-proof set; stronger proof-types
 *         (proof-of-personhood / KYC) drop into the same bitmask later without re-architecture.
 */
interface IValidationGate {
    /// @notice True iff `applicant` controls `agentId` and satisfies every bit in `requiredProofs`.
    function validate(uint256 agentId, address applicant, uint256 requiredProofs)
        external
        view
        returns (bool);
}
