// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title AttributionRegistry
 * @notice Holds Attribution Receipts (ARs): claims by an originator that they introduced /
 *         trained / vouched-for a worker, entitling them to a slice of Echo's fee on that
 *         worker's future deals. Provisional until an independent requester (who graded the
 *         worker) co-signs — this is the anti-sybil gate.
 * @dev UUPS upgradeable to match the rest of Echo. Payout math lives in AttributionPayout;
 *      this contract is storage + lifecycle only.
 */
contract AttributionRegistry is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    enum CurveType { Linear, FlatPerpetual, VolumeCap }
    enum AttributionType { Introduced, Vouched, Trained, Matched, Referred }

    struct AR {
        address originator;     // who gets paid
        uint256 workerAgentId;  // ERC-8004 identity of the introduced worker
        AttributionType aType;
        uint16 sliceBps;        // slice of Echo's fee, in basis points (1000 = 10% of the fee)
        CurveType curve;
        uint48 startTime;       // set at confirmation; decay measured from here
        uint32 durationSecs;    // linear decay length / expiry
        uint256 volumeCap;      // cumulative USDC cap for VolumeCap curve (0 = none)
        uint256 paidToDate;     // cumulative USDC paid to this AR
        bool confirmed;
        bool revoked;
    }

    /// @dev Hard per-AR safety cap on the slice (the 40% ceiling is enforced in AttributionPayout).
    uint16 public constant MAX_SLICE_BPS = 5000;

    uint256 public arCount;
    mapping(uint256 => AR) public ars;
    mapping(uint256 => uint256[]) public workerARs;            // workerAgentId => arIds
    mapping(uint256 => mapping(address => bool)) public gradedBy; // workerAgentId => requester => graded

    address public payout;          // AttributionPayout, the only caller allowed to mark ARs paid
    address public marketRegistry;  // the only caller allowed to record independent grades

    event ARProposed(uint256 indexed id, address indexed originator, uint256 indexed workerAgentId, uint16 sliceBps);
    event ARConfirmed(uint256 indexed id, address indexed confirmingRequester, uint48 startTime);
    event ARRevoked(uint256 indexed id);
    event GradeRecorded(uint256 indexed workerAgentId, address indexed requester);
    event PaidRecorded(uint256 indexed id, uint256 amount);

    error NotPayout();
    error NotMarketRegistry();
    error NotProposable();
    error NoIndependentGrade();
    error SliceTooHigh();
    error AlreadySet();
    error ZeroAddress();

    function initialize() public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function setPayout(address _payout) external onlyOwner {
        if (payout != address(0)) revert AlreadySet();
        if (_payout == address(0)) revert ZeroAddress();
        payout = _payout;
    }

    function setMarketRegistry(address _marketRegistry) external onlyOwner {
        if (marketRegistry != address(0)) revert AlreadySet();
        if (_marketRegistry == address(0)) revert ZeroAddress();
        marketRegistry = _marketRegistry;
    }

    /// @notice Originator proposes a platform-intro AR for a worker. Provisional until confirmed.
    function proposeAR(
        uint256 workerAgentId,
        AttributionType aType,
        uint16 sliceBps,
        CurveType curve,
        uint32 durationSecs,
        uint256 volumeCap
    ) external returns (uint256 id) {
        if (sliceBps > MAX_SLICE_BPS) revert SliceTooHigh();

        id = ++arCount;
        AR storage a = ars[id];
        a.originator = msg.sender;
        a.workerAgentId = workerAgentId;
        a.aType = aType;
        a.sliceBps = sliceBps;
        a.curve = curve;
        a.durationSecs = durationSecs;
        a.volumeCap = volumeCap;

        workerARs[workerAgentId].push(id);
        emit ARProposed(id, msg.sender, workerAgentId, sliceBps);
    }

    /// @notice MarketRegistry records that an independent requester graded a worker up a tier.
    ///         This is the signal that confirms an AR is a real, vouched-for relationship.
    function recordGrade(uint256 workerAgentId, address requester) external {
        if (msg.sender != marketRegistry) revert NotMarketRegistry();
        gradedBy[workerAgentId][requester] = true;
        emit GradeRecorded(workerAgentId, requester);
    }

    /// @notice Confirm an AR using a requester who has graded the worker. The requester must be
    ///         independent of the originator (anti-sybil: Dana cannot confirm Sam=Dana).
    function confirmAR(uint256 id, address confirmingRequester) external {
        AR storage a = ars[id];
        if (a.originator == address(0) || a.confirmed || a.revoked) revert NotProposable();
        if (confirmingRequester == a.originator) revert NoIndependentGrade();
        if (!gradedBy[a.workerAgentId][confirmingRequester]) revert NoIndependentGrade();

        a.confirmed = true;
        a.startTime = uint48(block.timestamp);
        emit ARConfirmed(id, confirmingRequester, a.startTime);
    }

    function revoke(uint256 id) external {
        AR storage a = ars[id];
        if (msg.sender != a.originator && msg.sender != owner()) revert NotProposable();
        a.revoked = true;
        emit ARRevoked(id);
    }

    /// @notice Record a payout against an AR (volume-cap accounting). Only AttributionPayout.
    function markPaid(uint256 id, uint256 amount) external {
        if (msg.sender != payout) revert NotPayout();
        ars[id].paidToDate += amount;
        emit PaidRecorded(id, amount);
    }

    function getWorkerARs(uint256 workerAgentId) external view returns (uint256[] memory) {
        return workerARs[workerAgentId];
    }

    function getAR(uint256 id) external view returns (AR memory) {
        return ars[id];
    }

    /// @notice The first confirmed, active AR originator for a worker — used by the requester
    ///         pool to pay the worker's introducer. Returns exists=false if none.
    function primaryIntroducer(uint256 workerAgentId) external view returns (address originator, bool exists) {
        uint256[] storage ids = workerARs[workerAgentId];
        for (uint256 i; i < ids.length; ++i) {
            AR storage a = ars[ids[i]];
            if (a.confirmed && !a.revoked) {
                return (a.originator, true);
            }
        }
        return (address(0), false);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
