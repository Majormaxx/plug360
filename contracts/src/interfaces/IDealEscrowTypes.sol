// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title Shared types, events and errors for DealEscrow
/// @notice All amounts are USDC base units through the 6-decimal ERC-20 interface.
interface IDealEscrowTypes {
    /// @dev Refunded and Settled are final. None means the deal was never funded.
    enum Status {
        None,
        Held,
        Disputed,
        Released,
        Refunded,
        Settled
    }

    /// @dev Who sent the money back to the buyer.
    enum RefundReason {
        Seller,
        Plug,
        Timeout
    }

    /// @notice A funded deal. Every field except status, disputedAt, payoutPending and
    ///         evidenceHash is written once at funding and never changes.
    struct Deal {
        address buyer;
        address seller;
        address plug;
        address refundTo;
        uint96 price;
        uint96 plugFee;
        uint40 paidAt;
        uint40 releaseAt;
        uint40 disputedAt;
        Status status;
        bool payoutPending;
        bytes32 orderId;
        bytes32 evidenceHash;
    }

    /// @notice Deal terms, signed by the seller (EIP-712) and accepted by the plug.
    /// @param windowSeconds Money-back window, counted from funding. Zero means no window.
    /// @param expiry Unix time after which the signed terms can no longer be funded.
    /// @param metadataHash Hash of the off-chain job description and display data.
    struct Terms {
        address seller;
        address plug;
        bytes32 orderId;
        uint256 price;
        uint256 plugFee;
        uint32 windowSeconds;
        uint64 expiry;
        bytes32 metadataHash;
    }

    event DealFunded(
        uint256 indexed dealId,
        address indexed buyer,
        address indexed seller,
        address plug,
        bytes32 orderId,
        uint256 price,
        uint256 plugFee,
        uint256 escrowed,
        uint40 releaseAt,
        address refundTo
    );
    event DisputeOpened(uint256 indexed dealId, bytes32 evidenceHash, uint40 plugDeadline);
    event PlugRuled(uint256 indexed dealId, address indexed plug, bool forBuyer, bytes32 noteHash);
    event Refunded(uint256 indexed dealId, RefundReason reason, uint256 toBuyer, uint256 toPlug);
    event Released(uint256 indexed dealId, address indexed by);
    event Settled(uint256 indexed dealId, uint256 toSeller, uint256 toPlug);
    event PayoutDeferred(uint256 indexed dealId, address indexed to, uint256 amount);
    event PayoutRetried(uint256 indexed dealId, address indexed to, uint256 amount);
    event PlugLevelSet(address indexed plug, uint8 level);
    event NonceCancelled(address indexed buyer, uint256 nonce);
    event ExcessSwept(address indexed to, uint256 amount);

    error ZeroAddress();
    error SameParty();
    error InvalidRefundTo();
    error AmountOutOfRange();
    error FeeTooHigh();
    error FeeNotEven();
    error WindowTooLong();
    error TermsExpired();
    error TermsLifetimeTooLong();
    error InvalidSellerSignature();
    error InvalidPlugSignature();
    error PlugNotListed();
    error ExceedsPlugLevel();
    error OrderAlreadyPaid();
    error HeldCapExceeded();
    error TransferAmountMismatch();
    error CallerNotAllowed();
    error InvalidStatus();
    error WindowClosed();
    error WindowOpen();
    error AlreadyDisputed();
    error PlugDeadlinePassed();
    error PlugDeadlineNotReached();
    error SignatureExpired();
    error DeadlineAfterWindow();
    error InvalidBuyerSignature();
    error NoPendingPayout();
    error BatchTooLarge();
    error InvalidLevel();
    error NothingToSweep();
    error RenounceDisabled();
}
