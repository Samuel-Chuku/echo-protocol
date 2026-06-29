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
 *         confirm the rejection) and, for Mode A, slashes or refunds the returnable bond. Bounded
 *         damage from a wrong verdict is what lets the minimal jury be lighter than a money-oracle
 *         would require.
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

    /// @notice Flag a Mode-A reveal hold as contested (P6). Called when the requester opens a bonded
    ///         ModeAStake dispute against a revealed applicant — mirrors `markFindingDisputed` for
    ///         bounties. Moves the held stake into Flagged so it cannot be auto-returned while the
    ///         dispute is live. Reverts (unwinding the opener's bond) if the reveal isn't Held or the
    ///         flag window has elapsed.
    function markRevealFlagged(uint256 marketId, address participant) external;

    /// @notice Settle a flagged Mode-A reveal stake per the jury verdict (P6). `slash == true` is a
    ///         sustained bait-and-switch — forfeits the returnable stake to the requester (the harmed
    ///         party) via EchoHook.slashStake; `false` clears the applicant and refunds the stake.
    ///         Replaces the slash-only `slashStakeAdjudicated`: both verdict outcomes resolve the
    ///         hold so the stake is never stranded.
    function resolveStakeDispute(uint256 marketId, address participant, bool slash) external;

    /// @notice Mark a REJECTED Final-tier job as disputed. Called when its worker opens a bonded
    ///         TierJobRejection dispute — mirrors `markFindingDisputed` for tier jobs. Blocks
    ///         closeMarket from reclaiming the tier escrow while the dispute is live. `opener` is the
    ///         claimed worker; the market verifies it equals the Arc job's provider. Reverts
    ///         (unwinding the opener's bond) if the caller isn't the provider, the job isn't a
    ///         Rejected Final job of this market, or it's already disputed.
    function markTierJobDisputed(uint256 marketId, uint256 jobId, address opener) external;

    /// @notice Settle a disputed Final-tier job per the jury verdict. `workerWon == true` overturns
    ///         the rejection — pays the worker the tier amount (net of fee) from escrow via
    ///         EchoHook.settleDisputedTier and writes the same reputation a normal completion would;
    ///         `false` confirms the rejection — no money moves now and the escrow refunds the
    ///         requester on closeMarket. Clears the disputed flag so the market can close.
    function resolveTierJobDispute(uint256 marketId, uint256 jobId, bool workerWon) external;
}
