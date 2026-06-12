// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IDisputeAdjudicable
 * @notice The callback surface a market contract exposes to the adjudication ladder's staked-jury
 *         rung (DisputeResolver, spec §5). Kept as a narrow interface so the resolver never imports
 *         the full MarketRegistry — they couple only through these three calls, and a future
 *         money-oracle / Kleros court can drive the same surface.
 *
 *         The resolver is the only authorized caller (the market gates each function to its wired
 *         `disputeResolver`). De-risking property (spec §5): a verdict never claws back an
 *         already-paid reveal/finding — it only resolves the disputed item (pay the floor or
 *         confirm the rejection) and, for Mode A, slashes the bond. Bounded damage from a wrong
 *         verdict is what lets the minimal jury be lighter than a money-oracle would require.
 */
interface IDisputeAdjudicable {
    /// @notice Move a previously-Rejected bounty finding into the Disputed state (re-counts it as
    ///         pending so the bounty cannot be closed while the dispute is live). Called when a
    ///         submitter opens a dispute against a rejection.
    function markFindingDisputed(uint256 marketId, uint256 index) external;

    /// @notice Settle a disputed bounty finding per the jury verdict. `findingValid == true` pays
    ///         the submitter the defaultAward floor (capped at the remaining pool) and marks it
    ///         Accepted; `false` returns it to Rejected. Clears the pending re-count either way.
    function resolveDisputedFinding(uint256 marketId, uint256 index, bool findingValid) external;

    /// @notice Forfeit a Mode-A applicant's returnable stake to the requester (the harmed party)
    ///         after a sustained bait-and-switch verdict. Routes through EchoHook.slashStake. (The
    ///         Mode-A flag-window reveal rework that makes a live stake available is parked to P6;
    ///         this entrypoint is ready for it.)
    function slashStakeAdjudicated(uint256 marketId, address participant) external;
}
