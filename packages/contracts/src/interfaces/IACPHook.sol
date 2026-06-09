// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title IACPHook (ERC-8183 hook)
 * @notice The generic lifecycle-hook interface Arc's AgenticCommerce invokes on every
 *         job transition. A hook MUST be whitelisted by Arc admins AND advertise this
 *         interface via ERC-165, or `createJob` reverts.
 *
 *         AgenticCommerce calls `beforeAction`/`afterAction(jobId, msg.sig, data)` where
 *         `msg.sig` is the selector of the lifecycle function (createJob/submit/complete/
 *         reject/fund/setBudget) and `data` is its abi-encoded arguments. Implementers
 *         branch on the selector. Per EIP-8183 the interface declares exactly these two
 *         functions; `interfaceId = beforeAction.selector ^ afterAction.selector` (the
 *         inherited IERC165 selector is excluded by Solidity's `type(I).interfaceId`).
 */
interface IACPHook is IERC165 {
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
}
