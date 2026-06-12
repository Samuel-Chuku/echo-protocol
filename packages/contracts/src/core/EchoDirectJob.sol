// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIdentityRegistry} from "../interfaces/IERC8004.sol";
import {EchoHook} from "./EchoHook.sol";
import {AttributionRegistry} from "./AttributionRegistry.sol";

/**
 * @title EchoDirectJob
 * @notice Mode B (Direct Job + milestones, spec §2.2) lifecycle, extracted out of MarketRegistry
 *         as an external (delegatecall-linked) library — the second half of the P5 size relief
 *         (spec §8). Extracting Bounty alone left MarketRegistry 218 bytes over the 24,576-byte
 *         EIP-170 limit under the legacy (non-IR) pipeline; moving Mode B out as well clears it
 *         comfortably, so `via_ir` could be turned back off (fast builds restored) AND both heavy
 *         modes now live as lean libraries.
 *
 *         STORAGE STAYS IN THE REGISTRY. The `directJobs` / `directJobMilestones` mappings remain
 *         declared in MarketRegistry (slots 17/18); this library receives them as `storage`
 *         parameters. Invoked by `delegatecall`, so every state write lands in the registry's
 *         storage and every external call runs with `msg.sender` / `address(this)` == the registry
 *         — all `onlyRegistry` / allowance checks pass exactly as when the code was inline. Zero
 *         storage-layout change by construction.
 *
 *         The struct/enum types (`MilestoneStatus`, `DirectJob`, `Milestone`) now live here and are
 *         referenced as `EchoDirectJob.*`. Errors are re-declared with the SAME signatures as
 *         MarketRegistry's, so revert selectors are unchanged.
 *
 * @dev Mirrors EchoBounty's pattern exactly. No clawback of released/delivered milestones.
 */
library EchoDirectJob {
    using SafeERC20 for IERC20;

    /// @notice Milestone lifecycle (spec §2.2): Pending → Submitted → Released. A submitted
    ///         milestone is protected by the auto-release clock; a released one cannot be clawed back.
    enum MilestoneStatus { Pending, Submitted, Released }

    /// @notice A two-party direct job (Mode B). No applicant pool, teaser, reveal, or stake — the
    ///         parties already chose each other. Escrow custody reuses EchoHook (escrowed[marketId]).
    struct DirectJob {
        address requester;
        address worker;
        uint256 workerAgentId;     // for reputation/attribution (supplied by requester, unverified)
        uint256 requesterAgentId;
        bytes32 scopeHash;
        string metadataURI;
        uint256 reviewWindow;      // seconds after submit before a milestone may auto-release
        bool cancelled;
    }

    struct Milestone {
        uint256 amount;
        uint64 submittedAt;        // 0 until submitted; deadline = submittedAt + reviewWindow
        MilestoneStatus status;
        bytes32 deliverableHash;
    }

    /// @notice Contract handles the library needs, bundled into one memory argument.
    struct Deps {
        EchoHook echoHook;
        IERC20 usdc;
        IIdentityRegistry identityRegistry;
        AttributionRegistry attributionRegistry;
    }

    // Events emitted via delegatecall ⇒ emitting address is the registry proxy; topics identical
    // to the prior in-registry definitions, so indexers see no change.
    event DirectJobCreated(uint256 indexed marketId, address indexed requester, address indexed worker, uint256 total, uint256 milestoneCount);
    event MilestoneSubmitted(uint256 indexed marketId, uint256 indexed index, bytes32 deliverableHash);
    event MilestoneReleased(uint256 indexed marketId, uint256 indexed index, uint256 amount, bool autoReleased);
    event DirectJobCancelled(uint256 indexed marketId, uint256 refunded);

    // Errors re-declared with MarketRegistry-identical signatures (same 4-byte selectors).
    error NotRequester();
    error NotAgentOwner();
    error ZeroAddress();
    error NoMilestones();
    error NotWorker();
    error JobCancelled();
    error MilestoneNotPending();
    error MilestoneNotSubmitted();
    error ReviewWindowNotElapsed();
    error BadMilestoneIndex();
    error NotDirectJob();

    /// @notice Create a two-party direct job. The registry forwarder owns id allocation +
    ///         marketMode + the requesterMarkets index; this library owns validation, struct init,
    ///         milestone push, escrow, and the event.
    function createDirectJob(
        mapping(uint256 => DirectJob) storage directJobs,
        mapping(uint256 => Milestone[]) storage directJobMilestones,
        Deps memory d,
        uint256 marketId,
        address worker,
        uint256 workerAgentId,
        uint256 requesterAgentId,
        string memory metadataURI,
        bytes32 scopeHash,
        uint256[] memory milestoneAmounts,
        uint256 reviewWindow
    ) external {
        if (milestoneAmounts.length == 0) revert NoMilestones();
        if (worker == address(0)) revert ZeroAddress();
        if (!d.identityRegistry.isAuthorizedOrOwner(msg.sender, requesterAgentId)) revert NotAgentOwner();

        uint256 total;
        for (uint256 i; i < milestoneAmounts.length; ++i) {
            total += milestoneAmounts[i];
        }

        directJobs[marketId] = DirectJob({
            requester: msg.sender,
            worker: worker,
            workerAgentId: workerAgentId,
            requesterAgentId: requesterAgentId,
            scopeHash: scopeHash,
            metadataURI: metadataURI,
            reviewWindow: reviewWindow,
            cancelled: false
        });

        Milestone[] storage ms = directJobMilestones[marketId];
        for (uint256 i; i < milestoneAmounts.length; ++i) {
            ms.push(Milestone({amount: milestoneAmounts[i], submittedAt: 0, status: MilestoneStatus.Pending, deliverableHash: bytes32(0)}));
        }

        d.usdc.safeTransferFrom(msg.sender, address(d.echoHook), total);
        d.echoHook.fundEscrow(marketId, total);

        emit DirectJobCreated(marketId, msg.sender, worker, total, milestoneAmounts.length);
    }

    /// @notice Worker delivers a milestone — starts that milestone's review/auto-release clock.
    function submitMilestone(
        mapping(uint256 => DirectJob) storage directJobs,
        mapping(uint256 => Milestone[]) storage directJobMilestones,
        uint256 marketId,
        uint256 index,
        bytes32 deliverableHash
    ) external {
        DirectJob storage j = directJobs[marketId];
        if (msg.sender != j.worker) revert NotWorker();
        if (j.cancelled) revert JobCancelled();

        Milestone storage milestone = _at(directJobMilestones, marketId, index);
        if (milestone.status != MilestoneStatus.Pending) revert MilestoneNotPending();

        milestone.status = MilestoneStatus.Submitted;
        milestone.submittedAt = uint64(block.timestamp);
        milestone.deliverableHash = deliverableHash;

        emit MilestoneSubmitted(marketId, index, deliverableHash);
    }

    /// @notice Requester accepts a submitted milestone — pays that slice to the worker now.
    function acceptMilestone(
        mapping(uint256 => DirectJob) storage directJobs,
        mapping(uint256 => Milestone[]) storage directJobMilestones,
        Deps memory d,
        uint256 marketId,
        uint256 index
    ) external {
        DirectJob storage j = directJobs[marketId];
        if (msg.sender != j.requester) revert NotRequester();
        Milestone storage milestone = _at(directJobMilestones, marketId, index);
        if (milestone.status != MilestoneStatus.Submitted) revert MilestoneNotSubmitted();
        _release(d, j, milestone, marketId, index, false);
    }

    /// @notice Anyone may release a submitted milestone once its review window has elapsed — the
    ///         exit-theft guard (accept-but-don't-pay): silence never profits the silent party.
    function autoReleaseMilestone(
        mapping(uint256 => DirectJob) storage directJobs,
        mapping(uint256 => Milestone[]) storage directJobMilestones,
        Deps memory d,
        uint256 marketId,
        uint256 index
    ) external {
        DirectJob storage j = directJobs[marketId];
        Milestone storage milestone = _at(directJobMilestones, marketId, index);
        if (milestone.status != MilestoneStatus.Submitted) revert MilestoneNotSubmitted();
        if (block.timestamp < uint256(milestone.submittedAt) + j.reviewWindow) revert ReviewWindowNotElapsed();
        _release(d, j, milestone, marketId, index, true);
    }

    /// @notice Requester stops the job. Refunds only PENDING (un-submitted) milestones; SUBMITTED
    ///         ones stay funded so the worker can still auto-release them (no clawback of delivered
    ///         work). Released milestones are already paid. Idempotent via the cancelled flag.
    function cancelDirectJob(
        mapping(uint256 => DirectJob) storage directJobs,
        mapping(uint256 => Milestone[]) storage directJobMilestones,
        Deps memory d,
        uint256 marketId
    ) external {
        DirectJob storage j = directJobs[marketId];
        if (msg.sender != j.requester) revert NotRequester();
        if (j.cancelled) revert JobCancelled();
        j.cancelled = true;

        uint256 refund;
        Milestone[] storage ms = directJobMilestones[marketId];
        for (uint256 i; i < ms.length; ++i) {
            if (ms[i].status == MilestoneStatus.Pending) {
                refund += ms[i].amount;
            }
        }
        if (refund > 0) {
            d.echoHook.releaseEscrow(marketId, j.requester, refund);
        }

        emit DirectJobCancelled(marketId, refund);
    }

    // ──────────────────── internal ────────────────────

    function _release(
        Deps memory d,
        DirectJob storage j,
        Milestone storage milestone,
        uint256 marketId,
        uint256 index,
        bool autoReleased
    ) internal {
        milestone.status = MilestoneStatus.Released;
        d.echoHook.settleMilestone(marketId, j.worker, j.workerAgentId, j.requesterAgentId, milestone.amount);

        // A released milestone is an independent grade of the worker (confirms ARs, like Mode A).
        if (address(d.attributionRegistry) != address(0)) {
            d.attributionRegistry.recordGrade(j.workerAgentId, j.requester);
        }

        emit MilestoneReleased(marketId, index, milestone.amount, autoReleased);
    }

    function _at(
        mapping(uint256 => Milestone[]) storage directJobMilestones,
        uint256 marketId,
        uint256 index
    ) internal view returns (Milestone storage) {
        Milestone[] storage ms = directJobMilestones[marketId];
        if (index >= ms.length) revert BadMilestoneIndex();
        return ms[index];
    }
}
