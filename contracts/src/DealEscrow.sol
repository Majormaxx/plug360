// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IDealEscrow} from "./interfaces/IDealEscrow.sol";
import {IDealEscrowAdmin} from "./interfaces/IDealEscrowAdmin.sol";

/// @title DealEscrow
/// @notice Holds USDC for deals refereed by a plug. Each deal's money is accounted for on its own,
///         never pooled, and the owner cannot move it.
/// @dev Design modeled on Circle Research's Refund Protocol (Apache-2.0); see NOTICE.
///      Every final transition writes its status first, then pays each leg. A leg that fails (for
///      example, a blocklisted recipient) is parked on that deal alone and can be retried by anyone.
contract DealEscrow is IDealEscrow, EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice USDC through its 6-decimal ERC-20 interface. Native (18-decimal) balances are never read.
    IERC20 public immutable USDC;

    uint256 public constant MIN_AMOUNT = 1e6;
    uint256 public constant MAX_TOTAL_HELD = 2_500e6;
    uint32 public constant MAX_WINDOW = 14 days;
    uint32 public constant PLUG_WINDOW = 7 days;
    uint64 public constant MAX_TERMS_LIFETIME = 30 days;
    uint256 public constant MAX_FEE_BPS = 500;
    uint256 public constant MAX_BATCH = 50;
    uint8 public constant MAX_LEVEL = 5;

    bytes32 public constant TERMS_TYPEHASH = keccak256(
        "Terms(address seller,address plug,bytes32 orderId,uint256 price,uint256 plugFee,uint32 windowSeconds,uint64 expiry,bytes32 metadataHash)"
    );
    bytes32 public constant ACCEPT_TYPEHASH = keccak256("Accept(bytes32 termsHash,address plug)");
    bytes32 public constant RELEASE_TYPEHASH =
        keccak256("Release(uint256 dealId,address buyer,uint256 amount,uint256 nonce,uint256 deadline)");

    /// @inheritdoc IDealEscrowAdmin
    mapping(address plug => uint8 level) public plugLevel;

    /// @inheritdoc IDealEscrowAdmin
    mapping(address buyer => uint256 nonce) public releaseNonce;

    /// @inheritdoc IDealEscrowAdmin
    uint256 public totalHeld;

    /// @dev Payout legs still owed on a final deal.
    struct Pending {
        uint96 toRefund;
        uint96 toSeller;
        uint96 toPlug;
    }

    mapping(uint256 dealId => Deal) internal _deals;
    mapping(uint256 dealId => Pending) internal _pending;

    constructor(IERC20 usdc, address initialOwner) EIP712("DealEscrow", "1") Ownable(initialOwner) {
        if (address(usdc) == address(0)) revert ZeroAddress();
        USDC = usdc;
    }

    // ---------------------------------------------------------------- funding

    /// @inheritdoc IDealEscrow
    function pay(Terms calldata terms, bytes calldata sellerSig, bytes calldata plugSig, address refundTo)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 dealId)
    {
        address buyer = msg.sender;
        _checkTerms(terms, buyer, refundTo);

        dealId = dealIdOf(terms.seller, terms.orderId);
        if (_deals[dealId].status != Status.None) revert OrderAlreadyPaid();

        bytes32 th = termsHash(terms);
        if (!SignatureChecker.isValidSignatureNow(terms.seller, _hashTypedDataV4(th), sellerSig)) {
            revert InvalidSellerSignature();
        }
        if (!SignatureChecker.isValidSignatureNow(terms.plug, acceptDigest(th, terms.plug), plugSig)) {
            revert InvalidPlugSignature();
        }

        uint256 escrowed = terms.price + terms.plugFee / 2;
        if (totalHeld + escrowed > MAX_TOTAL_HELD) revert HeldCapExceeded();
        _record(dealId, terms, buyer, refundTo);
        totalHeld += escrowed;

        uint256 balanceBefore = USDC.balanceOf(address(this));
        USDC.safeTransferFrom(buyer, address(this), escrowed);
        if (USDC.balanceOf(address(this)) - balanceBefore != escrowed) revert TransferAmountMismatch();

        _emitFunded(dealId, escrowed);
    }

    // ---------------------------------------------------------------- buyer

    /// @inheritdoc IDealEscrow
    function openDispute(uint256 dealId, bytes32 evidenceHash) external nonReentrant {
        Deal storage d = _deals[dealId];
        if (msg.sender != d.buyer) revert CallerNotAllowed();
        if (d.status == Status.Disputed) revert AlreadyDisputed();
        if (d.status != Status.Held) revert InvalidStatus();
        if (block.timestamp >= d.releaseAt) revert WindowClosed();

        d.status = Status.Disputed;
        d.disputedAt = uint40(block.timestamp);
        d.evidenceHash = evidenceHash;
        emit DisputeOpened(dealId, evidenceHash, uint40(block.timestamp + PLUG_WINDOW));
    }

    /// @inheritdoc IDealEscrow
    function release(uint256 dealId) external nonReentrant {
        Deal storage d = _deals[dealId];
        if (msg.sender != d.buyer) revert CallerNotAllowed();
        _release(dealId, d);
    }

    /// @inheritdoc IDealEscrow
    /// @dev The signed amount is the deal's escrowed total (price + buyer's fee half). The nonce is the
    ///      buyer's current releaseNonce and is consumed on use.
    function releaseWithSig(uint256 dealId, uint256 deadline, bytes calldata buyerSig) external nonReentrant {
        Deal storage d = _deals[dealId];
        if (d.status != Status.Held && d.status != Status.Disputed) revert InvalidStatus();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (deadline > d.releaseAt) revert DeadlineAfterWindow();

        address buyer = d.buyer;
        uint256 nonce = releaseNonce[buyer];
        bytes32 digest = releaseDigest(dealId, buyer, _escrowed(d), nonce, deadline);
        if (!SignatureChecker.isValidSignatureNow(buyer, digest, buyerSig)) revert InvalidBuyerSignature();
        releaseNonce[buyer] = nonce + 1;

        _release(dealId, d);
    }

    // ---------------------------------------------------------------- seller

    /// @inheritdoc IDealEscrow
    function refund(uint256 dealId) external nonReentrant {
        Deal storage d = _deals[dealId];
        if (msg.sender != d.seller) revert CallerNotAllowed();
        if (d.status != Status.Held && d.status != Status.Disputed) revert InvalidStatus();
        _refundInFull(dealId, d, RefundReason.Seller);
    }

    // ---------------------------------------------------------------- plug

    /// @inheritdoc IDealEscrow
    function plugRefund(uint256 dealId, bytes32 noteHash) external nonReentrant {
        Deal storage d = _deals[dealId];
        _checkPlugRuling(d);

        uint256 buyerHalf = d.plugFee / 2;
        d.status = Status.Refunded;
        emit PlugRuled(dealId, msg.sender, true, noteHash);
        emit Refunded(dealId, RefundReason.Plug, d.price, buyerHalf);
        _pay(dealId, d.refundTo, d.price, Leg.Refund);
        // Accepted (see SECURITY.md): the only callee is USDC, which never calls back; all entry points are nonReentrant.
        // slither-disable-next-line reentrancy-no-eth
        _pay(dealId, d.plug, buyerHalf, Leg.Plug);
    }

    /// @inheritdoc IDealEscrow
    function plugReject(uint256 dealId, bytes32 noteHash) external nonReentrant {
        Deal storage d = _deals[dealId];
        _checkPlugRuling(d);

        d.status = Status.Released;
        emit PlugRuled(dealId, msg.sender, false, noteHash);
        emit Released(dealId, msg.sender);
    }

    // ---------------------------------------------------------------- anyone

    /// @inheritdoc IDealEscrow
    function finalizeExpiredDispute(uint256 dealId) external nonReentrant {
        Deal storage d = _deals[dealId];
        if (d.status != Status.Disputed) revert InvalidStatus();
        if (block.timestamp < uint256(d.disputedAt) + PLUG_WINDOW) revert PlugDeadlineNotReached();
        _refundInFull(dealId, d, RefundReason.Timeout);
    }

    /// @inheritdoc IDealEscrow
    function withdraw(uint256 dealId) external nonReentrant {
        _withdraw(dealId);
    }

    /// @inheritdoc IDealEscrow
    /// @dev All or nothing: one deal that cannot be withdrawn reverts the whole batch.
    function withdrawMany(uint256[] calldata dealIds) external nonReentrant {
        if (dealIds.length > MAX_BATCH) revert BatchTooLarge();
        for (uint256 i; i < dealIds.length; ++i) {
            _withdraw(dealIds[i]);
        }
    }

    /// @inheritdoc IDealEscrow
    function retryPayout(uint256 dealId) external nonReentrant {
        Deal storage d = _deals[dealId];
        Pending memory p = _pending[dealId];
        if (p.toRefund == 0 && p.toSeller == 0 && p.toPlug == 0) revert NoPendingPayout();

        // Effects first: clear the legs and the flag, then restore any leg whose transfer still fails.
        delete _pending[dealId];
        d.payoutPending = false;
        // Accepted (see SECURITY.md): the only callee is USDC, which never calls back; all entry points are nonReentrant.
        _repay(dealId, d.refundTo, p.toRefund, Leg.Refund);
        // slither-disable-next-line reentrancy-no-eth
        _repay(dealId, d.seller, p.toSeller, Leg.Seller);
        // slither-disable-next-line reentrancy-no-eth
        _repay(dealId, d.plug, p.toPlug, Leg.Plug);
    }

    // ---------------------------------------------------------------- owner

    /// @inheritdoc IDealEscrowAdmin
    function setPlugLevel(address plug, uint8 level) external onlyOwner {
        if (plug == address(0)) revert ZeroAddress();
        if (level > MAX_LEVEL) revert InvalidLevel();
        plugLevel[plug] = level;
        emit PlugLevelSet(plug, level);
    }

    /// @inheritdoc IDealEscrowAdmin
    function pause() external onlyOwner {
        _pause();
    }

    /// @inheritdoc IDealEscrowAdmin
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @inheritdoc IDealEscrowAdmin
    function sweepExcess(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = USDC.balanceOf(address(this));
        if (balance <= totalHeld) revert NothingToSweep();
        uint256 amount = balance - totalHeld;
        USDC.safeTransfer(to, amount);
        emit ExcessSwept(to, amount);
    }

    /// @notice Disabled: without an owner, plug levels and the pause switch could never change again.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ---------------------------------------------------------------- buyers

    /// @inheritdoc IDealEscrowAdmin
    function cancelNonce() external {
        uint256 nonce = releaseNonce[msg.sender]++;
        emit NonceCancelled(msg.sender, nonce);
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IDealEscrow
    function getDeal(uint256 dealId) external view returns (Deal memory) {
        return _deals[dealId];
    }

    /// @inheritdoc IDealEscrow
    function pendingPayouts(uint256 dealId) external view returns (uint256 toRefund, uint256 toSeller, uint256 toPlug) {
        Pending memory p = _pending[dealId];
        return (p.toRefund, p.toSeller, p.toPlug);
    }

    /// @inheritdoc IDealEscrowAdmin
    function levelCap(uint8 level) public pure returns (uint256) {
        if (level == 0) return 0;
        if (level == 1) return 5e6;
        if (level == 2) return 10e6;
        if (level == 3) return 25e6;
        if (level == 4) return 50e6;
        if (level == 5) return 100e6;
        revert InvalidLevel();
    }

    /// @inheritdoc IDealEscrowAdmin
    function dealIdOf(address seller, bytes32 orderId) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(seller, orderId)));
    }

    /// @inheritdoc IDealEscrowAdmin
    function termsHash(Terms calldata terms) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                TERMS_TYPEHASH,
                terms.seller,
                terms.plug,
                terms.orderId,
                terms.price,
                terms.plugFee,
                terms.windowSeconds,
                terms.expiry,
                terms.metadataHash
            )
        );
    }

    /// @inheritdoc IDealEscrowAdmin
    function termsDigest(Terms calldata terms) external view returns (bytes32) {
        return _hashTypedDataV4(termsHash(terms));
    }

    /// @inheritdoc IDealEscrowAdmin
    function acceptDigest(bytes32 termsHash_, address plug) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ACCEPT_TYPEHASH, termsHash_, plug)));
    }

    /// @inheritdoc IDealEscrowAdmin
    function releaseDigest(uint256 dealId, address buyer, uint256 amount, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(RELEASE_TYPEHASH, dealId, buyer, amount, nonce, deadline)));
    }

    // ---------------------------------------------------------------- internal

    enum Leg {
        Refund,
        Seller,
        Plug
    }

    function _checkTerms(Terms calldata terms, address buyer, address refundTo) internal view {
        if (terms.seller == address(0) || terms.plug == address(0) || refundTo == address(0)) revert ZeroAddress();
        if (terms.plug == terms.seller || terms.plug == buyer || terms.seller == buyer) revert SameParty();
        if (refundTo == terms.seller || refundTo == terms.plug) revert InvalidRefundTo();

        uint8 level = plugLevel[terms.plug];
        if (level == 0) revert PlugNotListed();
        if (terms.price < MIN_AMOUNT) revert AmountOutOfRange();
        if (terms.price > levelCap(level)) revert ExceedsPlugLevel();
        // price is at most 100e6 here, so the multiplication cannot overflow once plugFee <= price.
        if (terms.plugFee > terms.price || terms.plugFee * 10_000 > terms.price * MAX_FEE_BPS) revert FeeTooHigh();
        if (terms.plugFee % 2 != 0) revert FeeNotEven();
        if (terms.windowSeconds > MAX_WINDOW) revert WindowTooLong();
        if (block.timestamp >= terms.expiry) revert TermsExpired();
        if (terms.expiry > block.timestamp + MAX_TERMS_LIFETIME) revert TermsLifetimeTooLong();
    }

    function _record(uint256 dealId, Terms calldata terms, address buyer, address refundTo) internal {
        Deal storage d = _deals[dealId];
        d.buyer = buyer;
        d.seller = terms.seller;
        d.plug = terms.plug;
        d.refundTo = refundTo;
        d.price = uint96(terms.price);
        d.plugFee = uint96(terms.plugFee);
        d.paidAt = uint40(block.timestamp);
        d.releaseAt = uint40(block.timestamp + terms.windowSeconds);
        d.status = Status.Held;
        d.orderId = terms.orderId;
    }

    function _emitFunded(uint256 dealId, uint256 escrowed) internal {
        Deal storage d = _deals[dealId];
        emit DealFunded(
            dealId, d.buyer, d.seller, d.plug, d.orderId, d.price, d.plugFee, escrowed, d.releaseAt, d.refundTo
        );
    }

    function _checkPlugRuling(Deal storage d) internal view {
        if (msg.sender != d.plug) revert CallerNotAllowed();
        if (d.status != Status.Disputed) revert InvalidStatus();
        if (block.timestamp >= uint256(d.disputedAt) + PLUG_WINDOW) revert PlugDeadlinePassed();
    }

    function _escrowed(Deal storage d) internal view returns (uint256) {
        return uint256(d.price) + d.plugFee / 2;
    }

    function _release(uint256 dealId, Deal storage d) internal {
        if (d.status != Status.Held && d.status != Status.Disputed) revert InvalidStatus();
        d.status = Status.Released;
        emit Released(dealId, msg.sender);
    }

    function _refundInFull(uint256 dealId, Deal storage d, RefundReason reason) internal {
        uint256 amount = _escrowed(d);
        d.status = Status.Refunded;
        emit Refunded(dealId, reason, amount, 0);
        _pay(dealId, d.refundTo, amount, Leg.Refund);
    }

    function _withdraw(uint256 dealId) internal {
        Deal storage d = _deals[dealId];
        if (d.status == Status.Held) {
            if (block.timestamp < d.releaseAt) revert WindowOpen();
        } else if (d.status != Status.Released) {
            revert InvalidStatus();
        }

        uint256 fee = d.plugFee;
        uint256 toSeller = d.price - (fee - fee / 2);
        d.status = Status.Settled;
        emit Settled(dealId, toSeller, fee);
        _pay(dealId, d.seller, toSeller, Leg.Seller);
        // Accepted (see SECURITY.md): the only callee is USDC, which never calls back; all entry points are nonReentrant.
        // slither-disable-next-line reentrancy-no-eth
        _pay(dealId, d.plug, fee, Leg.Plug);
    }

    /// @dev Pays one leg. totalHeld drops before the call; if the transfer fails the amount is added
    ///      back and the leg is parked for retryPayout.
    function _pay(uint256 dealId, address to, uint256 amount, Leg leg) internal {
        if (amount == 0) return;
        totalHeld -= amount;
        // slither-disable-next-line reentrancy-no-eth,reentrancy-benign
        if (_transfer(to, amount)) return;
        // State is written after the call only on the failure path. Safe: every external entry point is
        // nonReentrant and the only callee is the immutable USDC contract.
        totalHeld += amount;
        _park(dealId, leg, amount);
        emit PayoutDeferred(dealId, to, amount);
    }

    /// @dev Retries one parked leg (already cleared by the caller); re-parks it if the transfer fails again.
    function _repay(uint256 dealId, address to, uint256 amount, Leg leg) internal {
        if (amount == 0) return;
        totalHeld -= amount;
        // slither-disable-next-line reentrancy-no-eth,reentrancy-benign
        if (_transfer(to, amount)) {
            emit PayoutRetried(dealId, to, amount);
            return;
        }
        totalHeld += amount;
        _park(dealId, leg, amount);
    }

    function _park(uint256 dealId, Leg leg, uint256 amount) internal {
        // casting to 'uint96' is safe because a leg never exceeds the deal's escrow (at most 102.5 USDC)
        // forge-lint: disable-next-line(unsafe-typecast)
        uint96 parked = uint96(amount);
        Pending storage p = _pending[dealId];
        if (leg == Leg.Refund) p.toRefund += parked;
        else if (leg == Leg.Seller) p.toSeller += parked;
        else p.toPlug += parked;
        _deals[dealId].payoutPending = true;
    }

    /// @dev Low-level so that any failure, including a blocklist revert or a malformed return value,
    ///      comes back as false instead of reverting the whole transition.
    function _transfer(address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory ret) = address(USDC).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        return ok && (ret.length == 0 ? address(USDC).code.length != 0 : (ret.length == 32 && abi.decode(ret, (bool))));
    }
}

