// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {EchoHook} from "./EchoHook.sol";

/**
 * @title EchoReveal
 * @notice Mode-A reveal stake-hold lifecycle (P6, spec §4/§8), extracted out of MarketRegistry as
 *         an external (delegatecall-linked) library — the same "keep proxies lean" size relief the
 *         P5 EchoBounty / EchoDirectJob extraction used (spec §8). The P6 stake-hold + flag-window
 *         functions pushed the registry back over the 24,576-byte EIP-170 limit under the legacy
 *         (non-IR) pipeline; moving them here clears it comfortably so `via_ir` stays OFF.
 *
 *         STORAGE STAYS IN THE REGISTRY. The `revealHolds` / `revealFlagWindow` mappings remain
 *         declared in MarketRegistry (slots 24/23); this library receives them as `storage`
 *         parameters. Invoked by `delegatecall`, so every state write lands in the registry's
 *         storage and every external call (`echoHook.refundStake` / `echoHook.slashStake`) runs with
 *         `msg.sender` / `address(this)` == the registry — all `onlyRegistry` checks pass exactly as
 *         when the code was inline. Zero storage-layout change by construction.
 *
 *         The `RevealStatus` enum + `RevealHold` struct live here and are referenced as
 *         `EchoReveal.*` from the registry and tests. Errors are re-declared with the SAME
 *         signatures as MarketRegistry's, so a revert from this library carries an identical 4-byte
 *         selector — `MarketRegistry.RevealNotHeld.selector` still matches.
 *
 * @dev THE LIFECYCLE. On reveal the registry sets a hold {revealedAt, Held} (inline — a tiny write).
 *      From there:
 *        - settleRevealStake: permissionless default-resolve. Once the flag window elapses unflagged,
 *          anyone returns the stake to the applicant (silence favors the applicant, like the other
 *          modes' auto-release / auto-escalate timeouts).
 *        - markRevealFlagged: resolver-driven (the registry gates the caller). The requester opened a
 *          bonded ModeAStake dispute → freeze the hold to Flagged so it can't be auto-returned or
 *          closed over. Reverts (unwinding the opener's bond) if not a flaggable held reveal.
 *        - resolveStakeDispute: resolver-driven verdict. slash ⇒ stake to the requester (+ the -1
 *          P-Rep written inside EchoHook.slashStake); cleared ⇒ stake refunded. Both resolve the
 *          hold so the stake is never stranded. The reveal/accept money path is never clawed back.
 */
library EchoReveal {
    /// @notice Reveal stake lifecycle (P6). Held → Settled (window elapsed unflagged → auto-return)
    ///         or Held → Flagged (bonded bait dispute) → Settled (jury slashes or clears + refunds).
    ///         None is the default (no stake / never revealed). Layout: packs into one slot.
    enum RevealStatus { None, Held, Flagged, Settled }

    struct RevealHold {
        uint64 revealedAt;       // anchors the flag-window deadline
        RevealStatus status;
    }

    // Events emitted via delegatecall ⇒ the emitting address is the registry proxy; topics are
    // identical to the prior in-registry definitions, so indexers see no change.
    event RevealStakeReturned(uint256 indexed marketId, address indexed participant, uint256 amount);
    event RevealFlagged(uint256 indexed marketId, address indexed participant);
    event RevealStakeResolved(uint256 indexed marketId, address indexed participant, bool slashed);

    // Errors re-declared with MarketRegistry-identical signatures (same 4-byte selectors).
    error RevealNotHeld();
    error FlagWindowNotElapsed();
    error FlagWindowElapsed();
    error RevealNotFlagged();

    /// @notice Default-resolve a held reveal stake (spec §8). Permissionless: once the flag window
    ///         elapses with no flag, anyone may return the applicant's stake — silence favors the
    ///         applicant, mirroring the auto-release / auto-escalate timeouts of the other modes.
    function settleRevealStake(
        mapping(uint256 => mapping(address => RevealHold)) storage revealHolds,
        mapping(uint256 => uint256) storage revealFlagWindow,
        EchoHook echoHook,
        uint256 marketId,
        address participant
    ) external {
        RevealHold storage h = revealHolds[marketId][participant];
        if (h.status != RevealStatus.Held) revert RevealNotHeld();
        if (block.timestamp < uint256(h.revealedAt) + revealFlagWindow[marketId]) revert FlagWindowNotElapsed();

        h.status = RevealStatus.Settled;
        uint256 amount = echoHook.refundStake(marketId, participant);
        emit RevealStakeReturned(marketId, participant, amount);
    }

    /// @notice Freeze a held reveal as contested. Driven by the DisputeResolver when the requester
    ///         opens a bonded ModeAStake dispute — mirrors EchoBounty.markFindingDisputed. Only valid
    ///         while Held and the flag window is still open; reverting here unwinds the opener's bond.
    function markRevealFlagged(
        mapping(uint256 => mapping(address => RevealHold)) storage revealHolds,
        mapping(uint256 => uint256) storage revealFlagWindow,
        uint256 marketId,
        address participant
    ) external {
        RevealHold storage h = revealHolds[marketId][participant];
        if (h.status != RevealStatus.Held) revert RevealNotHeld();
        if (block.timestamp >= uint256(h.revealedAt) + revealFlagWindow[marketId]) revert FlagWindowElapsed();
        h.status = RevealStatus.Flagged;
        emit RevealFlagged(marketId, participant);
    }

    /// @notice Settle a flagged reveal stake per the jury verdict. `slash == true` forfeits the stake
    ///         to `requester` (the harmed party) via EchoHook.slashStake (which also writes the -1
    ///         P-Rep against `agentId`); `false` clears the applicant and refunds the stake. Both
    ///         outcomes resolve the hold so the stake is never stranded. The registry forwarder
    ///         supplies `requester` + `agentId` (its own application state) and gates the caller.
    function resolveStakeDispute(
        mapping(uint256 => mapping(address => RevealHold)) storage revealHolds,
        EchoHook echoHook,
        uint256 marketId,
        address participant,
        address requester,
        uint256 agentId,
        bool slash
    ) external {
        RevealHold storage h = revealHolds[marketId][participant];
        if (h.status != RevealStatus.Flagged) revert RevealNotFlagged();
        h.status = RevealStatus.Settled;

        if (slash) {
            echoHook.slashStake(marketId, participant, requester, agentId);
        } else {
            echoHook.refundStake(marketId, participant);
        }
        emit RevealStakeResolved(marketId, participant, slash);
    }
}
