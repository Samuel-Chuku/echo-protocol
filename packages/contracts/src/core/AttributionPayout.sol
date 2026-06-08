// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AttributionRegistry} from "./AttributionRegistry.sol";

/**
 * @title AttributionPayout
 * @notice The split calculator. Given Echo's fee on a deal and the worker, it computes each
 *         active AR's decayed slice, enforces the fee-share ceiling (default 40% of the fee),
 *         pro-rates any overflow, and returns the recipients/amounts for EchoHook to pay.
 * @dev EchoHook holds the USDC (the fee comes from its escrow) and performs the transfers.
 *      This contract only computes and records, so custody stays in one place.
 */
contract AttributionPayout is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    AttributionRegistry public registry;
    address public echoHook; // only EchoHook may settle

    /// @notice Max share of Echo's fee that can flow to all platform ARs on one deal (4000 = 40%).
    uint16 public feeShareCeilingBps;

    event AttributionSettled(uint256 indexed workerAgentId, uint256 fee, uint256 totalPaid);
    event CeilingUpdated(uint16 ceilingBps);

    error NotEchoHook();
    error AlreadySet();
    error ZeroAddress();
    error InvalidCeiling();

    function initialize(address _registry, uint16 _ceilingBps) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        if (_registry == address(0)) revert ZeroAddress();
        if (_ceilingBps > 10_000) revert InvalidCeiling();
        registry = AttributionRegistry(_registry);
        feeShareCeilingBps = _ceilingBps;
    }

    function setEchoHook(address _hook) external onlyOwner {
        if (echoHook != address(0)) revert AlreadySet();
        if (_hook == address(0)) revert ZeroAddress();
        echoHook = _hook;
    }

    function setCeiling(uint16 _ceilingBps) external onlyOwner {
        if (_ceilingBps > 10_000) revert InvalidCeiling();
        feeShareCeilingBps = _ceilingBps;
        emit CeilingUpdated(_ceilingBps);
    }

    /**
     * @notice Compute and record the attribution split for one settlement.
     * @param workerAgentId  the worker whose deal just settled
     * @param fee            Echo's fee on this deal, in USDC (the pool to split from)
     * @return recipients    originator addresses (entries with amount 0 are inactive — skip them)
     * @return amounts       USDC owed to each recipient
     * @return totalPaid     sum of amounts (EchoHook keeps fee - totalPaid as margin)
     */
    function settle(uint256 workerAgentId, uint256 fee)
        external
        returns (address[] memory recipients, uint256[] memory amounts, uint256 totalPaid)
    {
        if (msg.sender != echoHook) revert NotEchoHook();

        uint256[] memory ids = registry.getWorkerARs(workerAgentId);
        uint256 n = ids.length;
        recipients = new address[](n);
        amounts = new uint256[](n);

        // Pass 1 — what each active AR wants at its current (decayed, cap-clamped) slice.
        uint256[] memory wanted = new uint256[](n);
        uint256 sumWanted;
        for (uint256 i; i < n; ++i) {
            AttributionRegistry.AR memory a = registry.getAR(ids[i]);
            if (!a.confirmed || a.revoked) continue;

            uint256 slice = _currentSliceBps(a);
            if (slice == 0) continue;

            uint256 w = fee * slice / 10_000;
            if (a.curve == AttributionRegistry.CurveType.VolumeCap && a.volumeCap > 0) {
                uint256 remaining = a.paidToDate >= a.volumeCap ? 0 : a.volumeCap - a.paidToDate;
                if (w > remaining) w = remaining;
            }
            if (w == 0) continue;

            wanted[i] = w;
            recipients[i] = a.originator;
            sumWanted += w;
        }

        // Pass 2 — enforce the ceiling (pro-rata if overflowing) and record.
        uint256 ceiling = fee * feeShareCeilingBps / 10_000;
        for (uint256 i; i < n; ++i) {
            uint256 amt = wanted[i];
            if (amt == 0) continue;
            if (sumWanted > ceiling) {
                amt = amt * ceiling / sumWanted; // proportional scale-down
            }
            if (amt == 0) {
                recipients[i] = address(0);
                continue;
            }
            amounts[i] = amt;
            totalPaid += amt;
            registry.markPaid(ids[i], amt);
        }

        emit AttributionSettled(workerAgentId, fee, totalPaid);
    }

    /// @dev Current slice in bps after applying the AR's curve.
    function _currentSliceBps(AttributionRegistry.AR memory a) internal view returns (uint256) {
        if (a.curve == AttributionRegistry.CurveType.FlatPerpetual) {
            return a.sliceBps;
        }
        if (a.curve == AttributionRegistry.CurveType.VolumeCap) {
            return a.sliceBps; // flat slice; expiry handled via volumeCap in settle()
        }
        // Linear: full slice at startTime, decaying to zero across durationSecs, then expired.
        if (a.durationSecs == 0) return 0;
        uint256 elapsed = block.timestamp - a.startTime;
        if (elapsed >= a.durationSecs) return 0;
        return uint256(a.sliceBps) * (a.durationSecs - elapsed) / a.durationSecs;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
