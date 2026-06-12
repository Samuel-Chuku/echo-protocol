// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIdentityRegistry} from "../interfaces/IERC8004.sol";
import {IValidationGate} from "../interfaces/IValidationGate.sol";
import {EchoHook} from "./EchoHook.sol";
import {AttributionRegistry} from "./AttributionRegistry.sol";

/**
 * @title EchoBounty
 * @notice Mode Bounty (spec §2.3) lifecycle, extracted out of MarketRegistry as an external
 *         (delegatecall-linked) library so its bytecode lives in the library, not the registry
 *         proxy. This is the P5 "keep proxies lean" relief (spec §8): once the bounty lifecycle
 *         left MarketRegistry's runtime, the registry dropped back under the 24,576-byte EIP-170
 *         limit and `via_ir` could be turned OFF again (fast builds restored).
 *
 *         STORAGE STAYS IN THE REGISTRY. The `bounties` / `bountyFindings` / `bountyPendingCount`
 *         mappings remain declared in MarketRegistry (slots 19/20/21); this library receives them
 *         as `storage` parameters. Because the library is invoked by `delegatecall`, every state
 *         write lands in the registry's storage and every external call (`echoHook.settleFinding`,
 *         `usdc.safeTransferFrom`, `attributionRegistry.recordGrade`) runs with `msg.sender` and
 *         `address(this)` == the registry — so all `onlyRegistry` / allowance checks pass exactly
 *         as they did when this code was inline. Zero storage-layout change by construction.
 *
 *         The struct/enum types (`Bounty`, `Finding`, `FindingStatus`) now live here and are
 *         referenced as `EchoBounty.*` from the registry and tests. Errors are re-declared with
 *         the SAME signatures as MarketRegistry's, so a revert from this library carries an
 *         identical 4-byte selector — `MarketRegistry.NotBounty.selector` still matches.
 *
 * @dev P5 also adds `FindingStatus.Disputed` (appended enum value, uint8 — layout-safe) and the
 *      two dispute state-transition hooks (`markFindingDisputed` / `resolveDisputedFinding`) the
 *      DisputeResolver drives through the registry. No clawback of paid findings is ever possible.
 */
library EchoBounty {
    using SafeERC20 for IERC20;

    /// @notice Mirrors MarketRegistry.PROOF_IDENTITY / ValidationGate.PROOF_IDENTITY.
    uint256 internal constant PROOF_IDENTITY = 1 << 0;

    /// @notice Finding lifecycle. Pending → Accepted (paid) or Rejected (free). A Rejected finding
    ///         may be Disputed (P5 adjudication ladder); a Disputed finding resolves back to
    ///         Accepted (ruled valid → paid the floor) or Rejected (ruled invalid). Disputed is
    ///         appended last (uint8) so the enum stays storage-compatible with live P4 findings.
    enum FindingStatus { Pending, Accepted, Rejected, Disputed }

    /// @notice An open bounty. Many submit exposed findings; many get paid in parallel. Pool
    ///         custody reuses EchoHook (escrowed[marketId]). Layout identical to the P4 struct.
    struct Bounty {
        address requester;
        uint256 requesterAgentId;
        bytes32 scopeHash;
        string metadataURI;
        uint256 requiredProofs;  // submitter genesis filter (reuses ValidationGate)
        uint256 defaultAward;    // floor per accepted finding + the amount an auto-escalation pays
        uint256 reviewWindow;    // seconds after submit before a finding may auto-escalate
        bool closed;
    }

    struct Finding {
        address submitter;
        uint256 submitterAgentId;
        bytes32 findingHash;     // commitment to the publicly-shared (exposed) result
        uint64 submittedAt;
        FindingStatus status;
        uint256 award;           // paid amount once Accepted (0 otherwise)
    }

    /// @notice Contract handles the library needs, bundled so the registry can pass them in one
    ///         memory argument (keeps the registry forwarders thin and the stack shallow).
    struct Deps {
        EchoHook echoHook;
        IERC20 usdc;
        IIdentityRegistry identityRegistry;
        IValidationGate validationGate;
        AttributionRegistry attributionRegistry;
    }

    // Events emitted via delegatecall ⇒ the emitting address is the registry proxy; topics are
    // identical to the prior in-registry definitions, so indexers see no change.
    event BountyCreated(uint256 indexed marketId, address indexed requester, uint256 pool, uint256 defaultAward);
    event FindingSubmitted(uint256 indexed marketId, uint256 indexed index, address indexed submitter, bytes32 findingHash);
    event FindingAccepted(uint256 indexed marketId, uint256 indexed index, uint256 award, bool autoEscalated);
    event FindingRejected(uint256 indexed marketId, uint256 indexed index);
    event FindingDisputed(uint256 indexed marketId, uint256 indexed index);
    event FindingDisputeResolved(uint256 indexed marketId, uint256 indexed index, bool findingValid, uint256 award);
    event BountyClosed(uint256 indexed marketId, uint256 refunded);

    // Errors re-declared with MarketRegistry-identical signatures (same 4-byte selectors).
    error InsufficientEscrow(uint256 provided, uint256 required);
    error NotRequester();
    error NotAgentOwner();
    error ValidationFailed();
    error ReviewWindowNotElapsed();
    error NotBounty();
    error BountyIsClosed();
    error FindingNotPending();
    error BadFindingIndex();
    error AwardBelowFloor();
    error AwardExceedsPool();
    error FindingsStillPending();
    error FindingNotRejected();
    error FindingNotDisputed();

    /// @notice Create an open bounty (spec §2.3). Escrows the pool to EchoHook and initialises the
    ///         Bounty record. The registry forwarder owns id allocation + marketMode + the
    ///         requesterMarkets index; this library owns validation, struct init, escrow, and the
    ///         event. Awards are bounded below by defaultAward and above by the remaining pool.
    function createBounty(
        mapping(uint256 => Bounty) storage bounties,
        Deps memory d,
        uint256 marketId,
        uint256 requesterAgentId,
        string memory metadataURI,
        bytes32 scopeHash,
        uint256 requiredProofs,
        uint256 defaultAward,
        uint256 reviewWindow,
        uint256 pool
    ) external {
        if (defaultAward == 0 || pool < defaultAward) revert InsufficientEscrow(pool, defaultAward);
        if (!d.identityRegistry.isAuthorizedOrOwner(msg.sender, requesterAgentId)) revert NotAgentOwner();

        bounties[marketId] = Bounty({
            requester: msg.sender,
            requesterAgentId: requesterAgentId,
            scopeHash: scopeHash,
            metadataURI: metadataURI,
            requiredProofs: requiredProofs | PROOF_IDENTITY,
            defaultAward: defaultAward,
            reviewWindow: reviewWindow,
            closed: false
        });

        d.usdc.safeTransferFrom(msg.sender, address(d.echoHook), pool);
        d.echoHook.fundEscrow(marketId, pool);

        emit BountyCreated(marketId, msg.sender, pool, defaultAward);
    }

    /// @notice Submit an exposed finding. Open to anyone passing the genesis filter (same gate as
    ///         Mode A entry — validation, not reputation); one submitter may post many. The hash
    ///         commits to a result shared openly off-chain (exposed, the opposite of Mode A gating).
    function submitFinding(
        mapping(uint256 => Bounty) storage bounties,
        mapping(uint256 => Finding[]) storage bountyFindings,
        mapping(uint256 => uint256) storage bountyPendingCount,
        Deps memory d,
        uint256 marketId,
        uint256 submitterAgentId,
        bytes32 findingHash
    ) external returns (uint256 index) {
        Bounty storage b = bounties[marketId];
        if (b.requester == address(0)) revert NotBounty();
        if (b.closed) revert BountyIsClosed();

        if (address(d.validationGate) != address(0)) {
            if (!d.validationGate.validate(submitterAgentId, msg.sender, b.requiredProofs)) revert ValidationFailed();
        } else if (!d.identityRegistry.isAuthorizedOrOwner(msg.sender, submitterAgentId)) {
            revert NotAgentOwner();
        }

        Finding[] storage fs = bountyFindings[marketId];
        index = fs.length;
        fs.push(Finding({
            submitter: msg.sender,
            submitterAgentId: submitterAgentId,
            findingHash: findingHash,
            submittedAt: uint64(block.timestamp),
            status: FindingStatus.Pending,
            award: 0
        }));
        bountyPendingCount[marketId] += 1;

        emit FindingSubmitted(marketId, index, msg.sender, findingHash);
    }

    /// @notice Requester accepts a finding and pays `award` (>= defaultAward, <= remaining pool).
    ///         Many findings can be accepted in parallel — multiple winners.
    function acceptFinding(
        mapping(uint256 => Bounty) storage bounties,
        mapping(uint256 => Finding[]) storage bountyFindings,
        mapping(uint256 => uint256) storage bountyPendingCount,
        Deps memory d,
        uint256 marketId,
        uint256 index,
        uint256 award
    ) external {
        Bounty storage b = bounties[marketId];
        if (b.requester == address(0)) revert NotBounty();
        if (msg.sender != b.requester) revert NotRequester();
        Finding storage f = _at(bountyFindings, marketId, index);
        if (f.status != FindingStatus.Pending) revert FindingNotPending();
        if (award < b.defaultAward) revert AwardBelowFloor();
        if (award > d.echoHook.remainingEscrow(marketId)) revert AwardExceedsPool();
        _accept(bountyPendingCount, d, b, f, marketId, index, award, false);
    }

    /// @notice Requester rejects a finding (free, and disputable via the P5 adjudication ladder).
    ///         The active alternative to accepting — so close never deadlocks on a bad finding.
    function rejectFinding(
        mapping(uint256 => Bounty) storage bounties,
        mapping(uint256 => Finding[]) storage bountyFindings,
        mapping(uint256 => uint256) storage bountyPendingCount,
        uint256 marketId,
        uint256 index
    ) external {
        Bounty storage b = bounties[marketId];
        if (b.requester == address(0)) revert NotBounty();
        if (msg.sender != b.requester) revert NotRequester();
        Finding storage f = _at(bountyFindings, marketId, index);
        if (f.status != FindingStatus.Pending) revert FindingNotPending();

        f.status = FindingStatus.Rejected;
        bountyPendingCount[marketId] -= 1;
        emit FindingRejected(marketId, index);
    }

    /// @notice Anyone may force-accept a Pending finding for defaultAward once its review window
    ///         has elapsed — the ignore-theft guard (spec §2.3). Echo-native (Arc fires no expiry
    ///         hook). Capped at the remaining pool so it can never over-draw.
    function autoEscalateFinding(
        mapping(uint256 => Bounty) storage bounties,
        mapping(uint256 => Finding[]) storage bountyFindings,
        mapping(uint256 => uint256) storage bountyPendingCount,
        Deps memory d,
        uint256 marketId,
        uint256 index
    ) external {
        Bounty storage b = bounties[marketId];
        if (b.requester == address(0)) revert NotBounty();
        Finding storage f = _at(bountyFindings, marketId, index);
        if (f.status != FindingStatus.Pending) revert FindingNotPending();
        if (block.timestamp < uint256(f.submittedAt) + b.reviewWindow) revert ReviewWindowNotElapsed();

        uint256 award = b.defaultAward;
        uint256 remaining = d.echoHook.remainingEscrow(marketId);
        if (award > remaining) award = remaining;
        _accept(bountyPendingCount, d, b, f, marketId, index, award, true);
    }

    /// @notice Close a bounty and refund the unspent pool. Blocked while any finding is still
    ///         Pending OR Disputed (no-reclaim-while-pending; a contested finding re-counts as
    ///         pending), so a requester cannot reclaim over unjudged or actively-disputed work.
    function closeBounty(
        mapping(uint256 => Bounty) storage bounties,
        mapping(uint256 => uint256) storage bountyPendingCount,
        Deps memory d,
        uint256 marketId
    ) external {
        Bounty storage b = bounties[marketId];
        if (b.requester == address(0)) revert NotBounty();
        if (msg.sender != b.requester) revert NotRequester();
        if (b.closed) revert BountyIsClosed();
        if (bountyPendingCount[marketId] != 0) revert FindingsStillPending();

        b.closed = true;
        uint256 remaining = d.echoHook.remainingEscrow(marketId);
        if (remaining > 0) {
            d.echoHook.releaseEscrow(marketId, b.requester, remaining);
        }
        emit BountyClosed(marketId, remaining);
    }

    // ──────────────────── P5 adjudication state transitions (driven by DisputeResolver) ────────────────────

    /// @notice Move a Rejected finding into Disputed and re-count it as pending so `closeBounty`
    ///         is blocked while the dispute is live. The registry gates the caller to its
    ///         DisputeResolver; this only performs the state transition. A finding can be disputed
    ///         once — a second attempt sees status != Rejected and reverts.
    function markFindingDisputed(
        mapping(uint256 => Finding[]) storage bountyFindings,
        mapping(uint256 => uint256) storage bountyPendingCount,
        uint256 marketId,
        uint256 index
    ) external {
        Finding storage f = _at(bountyFindings, marketId, index);
        if (f.status != FindingStatus.Rejected) revert FindingNotRejected();
        f.status = FindingStatus.Disputed;
        bountyPendingCount[marketId] += 1;
        emit FindingDisputed(marketId, index);
    }

    /// @notice Settle a disputed finding per the adjudicated verdict. `findingValid == true` pays
    ///         the submitter the defaultAward floor (capped at the remaining pool) and marks the
    ///         finding Accepted; `false` returns it to Rejected. Either way the pending re-count
    ///         added at dispute time is cleared. Never claws back already-paid findings.
    function resolveDisputedFinding(
        mapping(uint256 => Bounty) storage bounties,
        mapping(uint256 => Finding[]) storage bountyFindings,
        mapping(uint256 => uint256) storage bountyPendingCount,
        Deps memory d,
        uint256 marketId,
        uint256 index,
        bool findingValid
    ) external {
        Bounty storage b = bounties[marketId];
        Finding storage f = _at(bountyFindings, marketId, index);
        if (f.status != FindingStatus.Disputed) revert FindingNotDisputed();

        if (findingValid) {
            uint256 award = b.defaultAward;
            uint256 remaining = d.echoHook.remainingEscrow(marketId);
            if (award > remaining) award = remaining;
            _accept(bountyPendingCount, d, b, f, marketId, index, award, true);
            emit FindingDisputeResolved(marketId, index, true, award);
        } else {
            f.status = FindingStatus.Rejected;
            bountyPendingCount[marketId] -= 1;
            emit FindingDisputeResolved(marketId, index, false, 0);
        }
    }

    // ──────────────────── internal (inlined into the external functions) ────────────────────

    function _accept(
        mapping(uint256 => uint256) storage bountyPendingCount,
        Deps memory d,
        Bounty storage b,
        Finding storage f,
        uint256 marketId,
        uint256 index,
        uint256 award,
        bool autoEscalated
    ) internal {
        f.status = FindingStatus.Accepted;
        f.award = award;
        bountyPendingCount[marketId] -= 1;

        d.echoHook.settleFinding(marketId, f.submitter, f.submitterAgentId, b.requesterAgentId, award);

        // An accepted finding is an independent grade of the submitter (confirms ARs, like Mode A/B).
        if (address(d.attributionRegistry) != address(0)) {
            d.attributionRegistry.recordGrade(f.submitterAgentId, b.requester);
        }

        emit FindingAccepted(marketId, index, award, autoEscalated);
    }

    function _at(
        mapping(uint256 => Finding[]) storage bountyFindings,
        uint256 marketId,
        uint256 index
    ) internal view returns (Finding storage) {
        Finding[] storage fs = bountyFindings[marketId];
        if (index >= fs.length) revert BadFindingIndex();
        return fs[index];
    }
}
