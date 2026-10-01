// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IDealEscrowAdmin} from "./IDealEscrowAdmin.sol";

/// @title DealEscrow deal lifecycle
/// @notice Escrowed USDC for a buyer-seller deal with a named plug as referee. A disputed deal
///         resolves one of two ways: refund to the buyer's fixed refundTo, or payout to the seller.
///         A plug that misses the 7-day ruling deadline forfeits the choice; anyone may then refund.
/// @dev With f = plugFee, buyerHalf = f / 2 and sellerHalf = f - buyerHalf. The buyer escrows
///      price + buyerHalf, and every outcome pays out exactly that amount:
///        settled:          seller price - sellerHalf, plug f
///        seller refund:    buyer price + buyerHalf
///        plug rules buyer: buyer price, plug buyerHalf
///        plug timeout:     buyer price + buyerHalf
interface IDealEscrow is IDealEscrowAdmin {
    /// @notice Funds a deal from the caller's USDC (price + buyerHalf) using the seller's signed
    ///         terms and the plug's acceptance. `refundTo` receives any refund and never changes.
    function pay(Terms calldata terms, bytes calldata sellerSig, bytes calldata plugSig, address refundTo)
        external
        returns (uint256 dealId);

    /// @notice Buyer opens the deal's single dispute, strictly before the window ends.
    function openDispute(uint256 dealId, bytes32 evidenceHash) external;

    /// @notice Buyer releases the money to the seller early. Also ends an open dispute.
    function release(uint256 dealId) external;

    /// @notice Anyone relays a buyer's signed early release.
    function releaseWithSig(uint256 dealId, uint256 deadline, bytes calldata buyerSig) external;

    /// @notice Seller sends the money back to the buyer, any time before withdrawal.
    function refund(uint256 dealId) external;

    /// @notice The deal's plug rules for the buyer within 7 days of the dispute.
    function plugRefund(uint256 dealId, bytes32 noteHash) external;

    /// @notice The deal's plug rejects the dispute within 7 days; the deal becomes Released.
    function plugReject(uint256 dealId, bytes32 noteHash) external;

    /// @notice Anyone refunds the buyer in full once the plug's 7 days have passed without a ruling.
    function finalizeExpiredDispute(uint256 dealId) external;

    /// @notice Anyone pays out a Released deal, or a Held deal whose window has ended.
    function withdraw(uint256 dealId) external;

    /// @notice withdraw for up to 50 deals in one call.
    function withdrawMany(uint256[] calldata dealIds) external;

    /// @notice Anyone retries payout legs that failed (for example, a blocklisted recipient).
    function retryPayout(uint256 dealId) external;

    function getDeal(uint256 dealId) external view returns (Deal memory);

    /// @notice Payout legs still owed for a final deal: refund address, seller, plug.
    function pendingPayouts(uint256 dealId) external view returns (uint256 toRefund, uint256 toSeller, uint256 toPlug);
}
