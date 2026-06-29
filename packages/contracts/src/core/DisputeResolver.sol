// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDisputeAdjudicable} from "../interfaces/IDisputeAdjudicable.sol";

/**
 * @title DisputeResolver
 * @notice The staked-jury rung of Echo's adjudication ladder (spec §5) — the trustless-ish
 *         backstop invoked only for genuinely contested, subjective verdicts the cheaper rungs
 *         couldn't settle. Kept as a lean UUPS sibling (not folded into MarketRegistry) per the
 *         spec's "keep proxies lean" rule, mirroring ValidationGate.
 *
 *         THE LADDER (spec §5), cheapest-first — this contract is rung 3:
 *           1. Agent first-pass (advisory). An off-chain LLM compares the finding to the
 *              acceptance criteria. Recorded here as a NON-BINDING `agentHint` (set by an
 *              owner-authorized oracle); never final on its own.
 *           2. Verified anchor (deterministic). Where a claim is ValidationRegistry-verified, the
 *              registry settles it with no human. PARKED drop-in (Arc's anchor ABI unverified) —
 *              the same slot World ID / KYC fill in ValidationGate.
 *           3. Staked jury (this contract). Both sides post a bond; an owner-appointed juror panel
 *              votes simple-majority; the loser's bond pays the winner + the winning-side jurors.
 *              The verdict is pushed back into the market via IDisputeAdjudicable.
 *
 *         WHAT'S MINIMAL-VS-PARKED (decided with the team): v1 ships an OWNER-APPOINTED panel +
 *         flat bond split + open (non-secret) majority vote. The vote engine is deliberately
 *         mode-agnostic so the FULL KLEROS COURT — token-staked juror draws, commit-reveal
 *         ballots, appeal rounds, juror incentive curves — drops into this same shell later
 *         without re-architecting the market side. That upgrade is parked.
 *
 *         DE-RISKING (spec §5): a verdict never moves the reveal fee / never claws back a paid
 *         finding — it only resolves the disputed item (pay the floor or confirm the rejection)
 *         and, for Mode A, slashes the returnable bond. Bounded damage from a wrong verdict is
 *         what lets this jury be lighter than a money-oracle would need to be. Symmetrically the
 *         dispute bond makes spamming false disputes -EV (a losing opener forfeits their bond).
 *
 * @dev Disputes are settled in the bond token (USDC on Arc). Bonds are escrowed in THIS contract;
 *      payouts draw only from the two bonds of a given dispute, never from any market escrow.
 *      Juror rewards are pull-based (claimJurorReward) so one unreachable juror can neither block
 *      resolution nor strand the others' rewards.
 */
contract DisputeResolver is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    /// @notice What a dispute is contesting. Live subjects: BountyFinding (a submitter contests a
    ///         rejection), ModeAStake (a requester flags a revealed applicant's held stake as
    ///         bait-and-switch), and TierJobRejection (a worker contests a rejected Final-tier job —
    ///         `target` holds the Arc jobId; the worker is the opener, the requester counters).
    ///         Appended last to preserve the on-chain enum layout across UUPS upgrades.
    enum Subject { BountyFinding, ModeAStake, TierJobRejection }

    enum Status { Open, Resolved }

    /// @notice One dispute. For a BountyFinding, `target` is the finding index and the question is
    ///         "is the finding valid?" — the opener (submitter) argues YES, the counter (requester)
    ///         argues NO. For a ModeAStake, `participant` is the staked applicant and the question
    ///         is "was this a sustained bait-and-switch?" — the opener (the requester) seeks the
    ///         slash, the counter (the applicant) defends. `forOpener` always tallies votes siding
    ///         with the OPENER (finding valid / slash sustained).
    struct Dispute {
        Subject subject;
        uint256 marketId;
        uint256 target;          // finding index for BountyFinding
        address participant;     // staked participant for ModeAStake
        address opener;          // posted the opening bond; argues the contested item should win
        address counter;         // posted the counter bond; argues it should lose
        uint256 bond;            // each side's bond (symmetric)
        uint64 votingEndsAt;
        uint32 forOpener;        // jurors siding with the opener (finding valid / slash sustained)
        uint32 against;          // jurors siding with the counter (finding invalid / no slash)
        uint256 jurorShare;      // per-winning-voter reward, fixed at resolve (0 until then)
        Status status;
        bytes32 agentHint;       // rung-1 advisory record (non-binding); 0 if unset
    }

    IERC20 public bondToken;
    IDisputeAdjudicable public market;     // the MarketRegistry proxy (gated callbacks)
    uint256 public minBond;                // minimum opening/counter bond
    uint64 public votingPeriod;            // seconds jurors have to vote once a dispute is countered
    address public agentOracle;            // may record the rung-1 advisory hint
    bool public modeAStakeEnabled;         // ModeAStake disputes gated off until the P6 reveal rework

    mapping(address => bool) public jurors;
    uint256 public jurorCount;

    uint256 public disputeCount;
    // Internal (not public): the struct-returning auto getter emits a 13-value tuple whose non-IR
    // codegen sits at the stack limit; the third dispute subject tipped it over. `getDispute` already
    // exposes the full struct, and no caller reads the raw getter — so dropping it is free and also
    // trims bytecode. Layout is unchanged (visibility doesn't affect storage slots).
    mapping(uint256 => Dispute) internal disputes;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(address => bool)) public votedForOpener; // a voter's recorded side
    mapping(uint256 => mapping(address => bool)) public jurorClaimed;

    event MarketSet(address indexed market);
    event JurorSet(address indexed juror, bool active);
    event ConfigSet(uint256 minBond, uint64 votingPeriod);
    event AgentOracleSet(address indexed oracle);
    event ModeAStakeEnabledSet(bool enabled);
    event DisputeOpened(uint256 indexed disputeId, Subject subject, uint256 indexed marketId, uint256 target, address indexed opener, uint256 bond);
    event DisputeCountered(uint256 indexed disputeId, address indexed counter, uint256 bond);
    event AgentHintRecorded(uint256 indexed disputeId, bytes32 hint);
    event Voted(uint256 indexed disputeId, address indexed juror, bool forOpener);
    event DisputeResolved(uint256 indexed disputeId, bool openerWon, uint32 forOpener, uint32 against);
    event BondPaid(uint256 indexed disputeId, address indexed to, uint256 amount);
    event JurorRewardClaimed(uint256 indexed disputeId, address indexed juror, uint256 amount);

    error ZeroAddress();
    error AlreadySet();
    error NotConfigured();
    error BondTooSmall();
    error NotOpen();
    error AlreadyCountered();
    error NotCountered();
    error NotJuror();
    error AlreadyVoted();
    error VotingClosed();
    error VotingNotOver();
    error NoVotes();
    error NotResolved();
    error NotAgentOracle();
    error SubjectNotEnabled();
    error NotWinningVoter();
    error NothingToClaim();

    modifier onlyAgentOracle() {
        if (msg.sender != agentOracle) revert NotAgentOracle();
        _;
    }

    function initialize(address _bondToken, uint256 _minBond, uint64 _votingPeriod) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        if (_bondToken == address(0)) revert ZeroAddress();
        bondToken = IERC20(_bondToken);
        minBond = _minBond;
        votingPeriod = _votingPeriod;
        emit ConfigSet(_minBond, _votingPeriod);
    }

    // ──────────────────── configuration (owner) ────────────────────

    /// @notice Wire the market this resolver adjudicates for. Set once (additive, migration-free).
    function setMarket(address _market) external onlyOwner {
        if (address(market) != address(0)) revert AlreadySet();
        if (_market == address(0)) revert ZeroAddress();
        market = IDisputeAdjudicable(_market);
        emit MarketSet(_market);
    }

    /// @notice Appoint / remove a panel juror. v1 panel is owner-curated; the parked Kleros upgrade
    ///         replaces this with token-staked random draws over the same vote engine.
    function setJuror(address juror, bool active) external onlyOwner {
        if (juror == address(0)) revert ZeroAddress();
        if (jurors[juror] != active) {
            jurors[juror] = active;
            jurorCount = active ? jurorCount + 1 : jurorCount - 1;
        }
        emit JurorSet(juror, active);
    }

    function setConfig(uint256 _minBond, uint64 _votingPeriod) external onlyOwner {
        minBond = _minBond;
        votingPeriod = _votingPeriod;
        emit ConfigSet(_minBond, _votingPeriod);
    }

    /// @notice Authorize the rung-1 advisory agent (may record a non-binding hint on a dispute).
    function setAgentOracle(address _oracle) external onlyOwner {
        agentOracle = _oracle;
        emit AgentOracleSet(_oracle);
    }

    /// @notice Enable ModeAStake disputes. The P6 reveal rework holds the applicant stake behind a
    ///         flag window (instead of refunding it atomically at reveal), so there is now a live
    ///         stake to flag and slash. Flip this on once the upgraded MarketRegistry is live.
    function setModeAStakeEnabled(bool enabled) external onlyOwner {
        modeAStakeEnabled = enabled;
        emit ModeAStakeEnabledSet(enabled);
    }

    // ──────────────────── dispute lifecycle ────────────────────

    /// @notice Open a dispute against a REJECTED bounty finding (the submitter contests the
    ///         rejection). The opener posts a bond and the resolver flips the finding to Disputed
    ///         on the market (so the bounty can't be closed out from under the dispute). The
    ///         requester then counters with a matching bond; jurors vote; the loser's bond pays
    ///         the winner + the winning-side panel.
    /// @param bond Opening bond (>= minBond), pulled from the opener in the bond token.
    function openFindingDispute(uint256 marketId, uint256 findingIndex, uint256 bond) external returns (uint256 disputeId) {
        if (address(market) == address(0)) revert NotConfigured();
        if (bond < minBond) revert BondTooSmall();

        bondToken.safeTransferFrom(msg.sender, address(this), bond);

        disputeId = ++disputeCount;
        Dispute storage d = disputes[disputeId];
        d.subject = Subject.BountyFinding;
        d.marketId = marketId;
        d.target = findingIndex;
        d.opener = msg.sender;
        d.bond = bond;
        d.status = Status.Open;

        // Flip the finding to Disputed on the market — reverts (e.g. FindingNotRejected) if it
        // isn't a rejected finding, which also unwinds the bond transfer above.
        market.markFindingDisputed(marketId, findingIndex);

        emit DisputeOpened(disputeId, Subject.BountyFinding, marketId, findingIndex, msg.sender, bond);
    }

    /// @notice Open a Mode-A bait-and-switch dispute against a revealed applicant's held stake (P6).
    ///         THIS IS THE FLAG: the requester (the slash-seeker) posts a bond and the resolver
    ///         freezes the reveal hold to Flagged on the market — mirrors openFindingDispute. The
    ///         applicant then counters with a matching bond to defend; jurors vote; resolve slashes
    ///         the stake to the requester (sustained) or refunds the applicant (cleared). Reverts
    ///         SubjectNotEnabled until the owner flips modeAStakeEnabled. The market call reverts (and
    ///         unwinds the bond) if the reveal isn't a flaggable held stake within its flag window.
    function openStakeDispute(uint256 marketId, address participant, uint256 bond) external returns (uint256 disputeId) {
        if (address(market) == address(0)) revert NotConfigured();
        if (!modeAStakeEnabled) revert SubjectNotEnabled();
        if (bond < minBond) revert BondTooSmall();

        bondToken.safeTransferFrom(msg.sender, address(this), bond);

        disputeId = ++disputeCount;
        Dispute storage d = disputes[disputeId];
        d.subject = Subject.ModeAStake;
        d.marketId = marketId;
        d.participant = participant;
        d.opener = msg.sender;
        d.bond = bond;
        d.status = Status.Open;

        // Flag the reveal on the market — reverts (RevealNotHeld / FlagWindowElapsed) if it isn't a
        // flaggable held stake, which also unwinds the bond transfer above.
        market.markRevealFlagged(marketId, participant);

        emit DisputeOpened(disputeId, Subject.ModeAStake, marketId, 0, msg.sender, bond);
    }

    /// @notice Open a dispute against a REJECTED Final-tier job — the worker's recourse for an unfair
    ///         reject. The worker (the job's Arc provider) posts a bond and the resolver marks the
    ///         job disputed on the market (so closeMarket can't reclaim the escrow from under the
    ///         dispute). The requester then counters with a matching bond; jurors vote; resolve pays
    ///         the worker the tier amount (sustained) or confirms the rejection (cleared). The market
    ///         call reverts — unwinding the bond — if the caller isn't the provider, the job isn't a
    ///         Rejected Final job of this market, or it's already disputed.
    /// @param jobId Arc jobId of the rejected Final-tier job (stored in `target`).
    /// @param bond  Opening bond (>= minBond), pulled from the worker in the bond token.
    function openTierJobDispute(uint256 marketId, uint256 jobId, uint256 bond) external returns (uint256 disputeId) {
        if (address(market) == address(0)) revert NotConfigured();
        if (bond < minBond) revert BondTooSmall();

        bondToken.safeTransferFrom(msg.sender, address(this), bond);

        disputeId = ++disputeCount;
        Dispute storage d = disputes[disputeId];
        d.subject = Subject.TierJobRejection;
        d.marketId = marketId;
        d.target = jobId;        // target reused as the Arc jobId
        d.opener = msg.sender;   // the worker
        d.bond = bond;
        d.status = Status.Open;

        // Mark the job disputed on the market — reverts (NotProvider / JobNotRejected / WrongMarket /
        // WrongTier / TierJobAlreadyDisputed) if it isn't a fresh Rejected Final job opened by its
        // provider, which also unwinds the bond transfer above.
        market.markTierJobDisputed(marketId, jobId, msg.sender);

        emit DisputeOpened(disputeId, Subject.TierJobRejection, marketId, jobId, msg.sender, bond);
    }

    /// @notice The defending side posts a matching counter bond, which opens the voting window.
    ///         Until countered, a dispute has no voting clock.
    function counter(uint256 disputeId) external {
        Dispute storage d = disputes[disputeId];
        if (d.opener == address(0) || d.status != Status.Open) revert NotOpen();
        if (d.counter != address(0)) revert AlreadyCountered();

        bondToken.safeTransferFrom(msg.sender, address(this), d.bond);
        d.counter = msg.sender;
        d.votingEndsAt = uint64(block.timestamp) + votingPeriod;

        emit DisputeCountered(disputeId, msg.sender, d.bond);
    }

    /// @notice Record the rung-1 advisory agent hint (non-binding; informs jurors, never decides).
    function recordAgentHint(uint256 disputeId, bytes32 hint) external onlyAgentOracle {
        Dispute storage d = disputes[disputeId];
        if (d.opener == address(0) || d.status != Status.Open) revert NotOpen();
        d.agentHint = hint;
        emit AgentHintRecorded(disputeId, hint);
    }

    /// @notice A panel juror votes. `forOpener == true` sides with the opener (the contested item
    ///         should win — finding valid / no slash); `false` sides with the counter. One vote per
    ///         juror, only within the voting window, only after the dispute has been countered.
    function vote(uint256 disputeId, bool forOpener) external {
        if (!jurors[msg.sender]) revert NotJuror();
        Dispute storage d = disputes[disputeId];
        if (d.counter == address(0)) revert NotCountered();
        if (d.status != Status.Open) revert NotOpen();
        if (block.timestamp >= d.votingEndsAt) revert VotingClosed();
        if (hasVoted[disputeId][msg.sender]) revert AlreadyVoted();

        hasVoted[disputeId][msg.sender] = true;
        votedForOpener[disputeId][msg.sender] = forOpener;
        if (forOpener) d.forOpener += 1;
        else d.against += 1;

        emit Voted(disputeId, msg.sender, forOpener);
    }

    /// @notice Tally the vote after the window closes and settle: push the verdict into the market,
    ///         then split bonds. Simple majority of cast votes; the opener wins ties (the item
    ///         keeps the benefit of the doubt — a flag must be SUSTAINED to bite, spec §5). The
    ///         winner is refunded their own bond; the loser's bond is split evenly among the
    ///         winning-side voters, claimed pull-style. Callable by anyone once voting is over.
    function resolve(uint256 disputeId) external {
        Dispute storage d = disputes[disputeId];
        if (d.counter == address(0)) revert NotCountered();
        if (d.status != Status.Open) revert NotResolved(); // already resolved
        if (block.timestamp < d.votingEndsAt) revert VotingNotOver();
        // No named `cast` local (non-IR stack relief, spec §8 — the third verdict branch left resolve
        // 1 slot too deep). votes > 0 is required so a tie can't divide-by-zero below.
        if (uint256(d.forOpener) + uint256(d.against) == 0) revert NoVotes();

        bool openerWon = _openerWon(d);
        d.status = Status.Resolved;

        // Push the verdict into the market (de-risked: never claws back paid money). Dispatch lives in
        // a helper to keep resolve()'s frame under the non-IR stack limit (spec §8).
        _pushVerdict(d, openerWon);

        // Refund the winner's own bond; fix the per-winning-voter share of the loser's bond. The
        // winning-vote count is read inline (no named local) for stack relief; it's > 0 because the
        // winning side holds the majority of a non-zero tally.
        address winner = openerWon ? d.opener : d.counter;
        bondToken.safeTransfer(winner, d.bond);
        emit BondPaid(disputeId, winner, d.bond);

        d.jurorShare = uint256(d.bond) / (openerWon ? d.forOpener : d.against);

        emit DisputeResolved(disputeId, openerWon, d.forOpener, d.against);
    }

    /// @dev Route a resolved verdict into the market per subject. Extracted from resolve() so its
    ///      three external call sites don't sit in the same stack frame as the bond settlement
    ///      (non-IR stack limit, spec §8).
    ///        BountyFinding    — openerWon ⇒ finding valid (pay floor); the opener is the submitter.
    ///        TierJobRejection — openerWon ⇒ rejection overturned, pay the worker the tier amount
    ///                           (`target` is the Arc jobId); the opener is the worker.
    ///        ModeAStake       — openerWon ⇒ sustained bait, slash the stake to the requester; the
    ///                           opener is the requester/slash-seeker.
    function _pushVerdict(Dispute storage d, bool openerWon) internal {
        if (d.subject == Subject.BountyFinding) {
            market.resolveDisputedFinding(d.marketId, d.target, openerWon);
        } else if (d.subject == Subject.TierJobRejection) {
            market.resolveTierJobDispute(d.marketId, d.target, openerWon);
        } else {
            market.resolveStakeDispute(d.marketId, d.participant, openerWon);
        }
    }

    /// @dev Whether the opener's side prevailed. The tie-break differs by subject. Only ModeAStake
    ///      requires a STRICT majority (a tie favors the counter → no slash; a flag must be SUSTAINED
    ///      to bite, spec §5). BountyFinding AND TierJobRejection give the opener the benefit of the
    ///      doubt on a tie (`forOpener >= against`): for a finding the item stays valid, and for a
    ///      tier rejection the worker — who performed and submitted the labor — gets paid when the
    ///      panel can't muster a majority against them (team decision: tie pays the worker). Used by
    ///      both resolve and claimJurorReward so the winning side is computed identically in both.
    function _openerWon(Dispute storage d) internal view returns (bool) {
        if (d.subject == Subject.ModeAStake) return d.forOpener > d.against;
        return d.forOpener >= d.against;
    }

    /// @notice A juror who voted on the WINNING side claims their flat share of the loser's bond.
    ///         Pull-based so one unreachable juror can't block resolution or the others' rewards.
    function claimJurorReward(uint256 disputeId) external {
        Dispute storage d = disputes[disputeId];
        if (d.status != Status.Resolved) revert NotResolved();
        if (!hasVoted[disputeId][msg.sender]) revert NotJuror();
        if (jurorClaimed[disputeId][msg.sender]) revert AlreadyVoted();

        bool openerWon = _openerWon(d);
        if (votedForOpener[disputeId][msg.sender] != openerWon) revert NotWinningVoter();

        uint256 share = d.jurorShare;
        if (share == 0) revert NothingToClaim();

        jurorClaimed[disputeId][msg.sender] = true;
        bondToken.safeTransfer(msg.sender, share);
        emit JurorRewardClaimed(disputeId, msg.sender, share);
    }

    function getDispute(uint256 disputeId) external view returns (Dispute memory) {
        return disputes[disputeId];
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
