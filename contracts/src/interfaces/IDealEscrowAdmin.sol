// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IDealEscrowTypes} from "./IDealEscrowTypes.sol";

/// @title DealEscrow owner controls, limits and EIP-712 hashing
/// @notice The owner can list plugs, pause new deals and sweep USDC sent here by mistake.
///         The owner can never move USDC that belongs to a deal.
interface IDealEscrowAdmin is IDealEscrowTypes {
    /// @notice Sets a plug's level (0 delists). Applies to deals funded afterwards only.
    function setPlugLevel(address plug, uint8 level) external;

    /// @notice Blocks new deals. Every exit path stays open while paused.
    function pause() external;

    function unpause() external;

    /// @notice Sends USDC held above what deals are owed to `to`.
    function sweepExcess(address to) external;

    /// @notice Invalidates the caller's current early-release signature nonce.
    function cancelNonce() external;

    function plugLevel(address plug) external view returns (uint8);

    /// @notice Largest deal price a plug of `level` may referee; 0 for level 0.
    function levelCap(uint8 level) external pure returns (uint256);

    /// @notice USDC currently owed to deals, including deferred payout legs.
    function totalHeld() external view returns (uint256);

    function releaseNonce(address buyer) external view returns (uint256);

    /// @notice Deterministic deal id: one per (seller, orderId).
    function dealIdOf(address seller, bytes32 orderId) external pure returns (uint256);

    /// @notice EIP-712 struct hash of the terms. The plug's Accept signs over this value.
    function termsHash(Terms calldata terms) external pure returns (bytes32);

    /// @notice Full EIP-712 digest the seller signs.
    function termsDigest(Terms calldata terms) external view returns (bytes32);

    /// @notice Full EIP-712 digest the plug signs to accept `termsHash_`.
    function acceptDigest(bytes32 termsHash_, address plug) external view returns (bytes32);

    /// @notice Full EIP-712 digest the buyer signs for an early release.
    function releaseDigest(uint256 dealId, address buyer, uint256 amount, uint256 nonce, uint256 deadline)
        external
        view
        returns (bytes32);
}
