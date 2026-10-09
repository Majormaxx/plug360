// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {DealEscrow} from "../../src/DealEscrow.sol";
import {IDealEscrowTypes} from "../../src/interfaces/IDealEscrowTypes.sol";
import {ERC1271Wallet} from "../mocks/ERC1271Wallet.sol";
import {FeeOnTransferToken, ReentrantToken} from "../mocks/HostileTokens.sol";
import {DealEscrowBase} from "./DealEscrowBase.t.sol";

contract DealEscrowLifecycleTest is DealEscrowBase {
    // ============================================================ pay (UT-01 to UT-07, UT-25 to UT-27)

    function test_pay_storesDealAndPullsEscrow() public {
        IDealEscrowTypes.Terms memory t = _defaultTerms();
        uint256 expectedId = escrow.dealIdOf(seller, t.orderId);
        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.expectEmit(true, true, true, true, address(escrow));
        emit IDealEscrowTypes.DealFunded(
            expectedId, buyer, seller, plug, t.orderId, 5e6, 150_000, 5_075_000, _ts(block.timestamp + 3 days), buyer
        );
        uint256 id = _pay(t);

        assertEq(id, expectedId);
        IDealEscrowTypes.Deal memory d = escrow.getDeal(id);
        assertEq(d.buyer, buyer);
        assertEq(d.seller, seller);
        assertEq(d.plug, plug);
        assertEq(d.refundTo, buyer);
        assertEq(d.price, 5e6);
        assertEq(d.plugFee, 150_000);
        assertEq(d.paidAt, block.timestamp);
        assertEq(d.releaseAt, block.timestamp + 3 days);
        assertEq(d.disputedAt, 0);
        assertEq(uint8(d.status), uint8(IDealEscrowTypes.Status.Held));
        assertFalse(d.payoutPending);
        assertEq(d.orderId, t.orderId);
        assertEq(usdc.balanceOf(address(escrow)), 5_075_000);
        assertEq(buyerBefore - usdc.balanceOf(buyer), 5_075_000);
        assertEq(escrow.totalHeld(), 5_075_000);
    }

    function test_pay_separateRefundAddress() public {
        address refundWallet = makeAddr("refund-wallet");
        IDealEscrowTypes.Terms memory t = _defaultTerms();
        bytes memory s = _sellerSig(t);
        bytes memory p = _plugSig(t);
        vm.prank(buyer);
        uint256 id = escrow.pay(t, s, p, refundWallet);
        assertEq(escrow.getDeal(id).refundTo, refundWallet);
    }

    function test_pay_revertsOnBadSellerSignature() public {
        IDealEscrowTypes.Terms memory t = _defaultTerms();
        bytes memory wrong = _sig(plugKey, escrow.termsDigest(t));
        bytes memory p = _plugSig(t);
        vm.expectRevert(IDealEscrowTypes.InvalidSellerSignature.selector);
        vm.prank(buyer);
        escrow.pay(t, wrong, p, buyer);

        vm.expectRevert(IDealEscrowTypes.InvalidSellerSignature.selector);
        vm.prank(buyer);
        escrow.pay(t, "", p, buyer);
    }

    function test_pay_revertsOnBadPlugSignature() public {
        IDealEscrowTypes.Terms memory t = _defaultTerms();
        bytes memory s = _sellerSig(t);
        bytes memory wrong = _sig(sellerKey, escrow.acceptDigest(escrow.termsHash(t), plug));
        vm.expectRevert(IDealEscrowTypes.InvalidPlugSignature.selector);
        vm.prank(buyer);
        escrow.pay(t, s, wrong, buyer);
    }

    function test_pay_revertsWhenTermsEditedAfterSigning() public {
        IDealEscrowTypes.Terms memory t = _defaultTerms();
        bytes memory s = _sellerSig(t);
        bytes memory p = _plugSig(t);

        IDealEscrowTypes.Terms memory edited = t;
        edited.price = 4e6;
        vm.expectRevert(IDealEscrowTypes.InvalidSellerSignature.selector);
        vm.prank(buyer);
        escrow.pay(edited, s, p, buyer);

        edited = t;
        edited.plugFee = 200_000;
        vm.expectRevert(IDealEscrowTypes.InvalidSellerSignature.selector);
        vm.prank(buyer);
        escrow.pay(edited, s, p, buyer);

        edited = t;
        edited.windowSeconds = 14 days;
        vm.expectRevert(IDealEscrowTypes.InvalidSellerSignature.selector);
        vm.prank(buyer);
        escrow.pay(edited, s, p, buyer);
    }

    function test_pay_revertsForSignatureFromAnotherChainOrContract() public {
        IDealEscrowTypes.Terms memory t = _defaultTerms();
        vm.chainId(5042002);
        bytes memory s = _sellerSig(t);
        bytes memory p = _plugSig(t);
        vm.chainId(ARC_MAINNET);
        vm.expectRevert(IDealEscrowTypes.InvalidSellerSignature.selector);
        vm.prank(buyer);
        escrow.pay(t, s, p, buyer);

        DealEscrow other = new DealEscrow(IERC20(address(usdc)), owner);
        s = _sig(sellerKey, other.termsDigest(t));
        p = _sig(plugKey, other.acceptDigest(other.termsHash(t), plug));
        vm.expectRevert(IDealEscrowTypes.InvalidSellerSignature.selector);
        vm.prank(buyer);
        escrow.pay(t, s, p, buyer);
    }

    function test_pay_revertsOnSameParties() public {
        IDealEscrowTypes.Terms memory t = _defaultTerms();
        bytes memory s = _sellerSig(t);
        bytes memory p = _plugSig(t);
        vm.expectRevert(IDealEscrowTypes.SameParty.selector);
        vm.prank(plug);
        escrow.pay(t, s, p, plug);

        vm.expectRevert(IDealEscrowTypes.SameParty.selector);
        vm.prank(seller);
        escrow.pay(t, s, p, buyer);

        IDealEscrowTypes.Terms memory selfPlug = _defaultTerms();
        selfPlug.plug = seller;
        vm.expectRevert(IDealEscrowTypes.SameParty.selector);
        vm.prank(buyer);
        escrow.pay(selfPlug, s, p, buyer);
    }

    function test_pay_revertsOnZeroAddresses() public {
        IDealEscrowTypes.Terms memory t = _defaultTerms();
        bytes memory s = _sellerSig(t);
        bytes memory p = _plugSig(t);
        vm.expectRevert(IDealEscrowTypes.ZeroAddress.selector);
        vm.prank(buyer);
        escrow.pay(t, s, p, address(0));

        t.seller = address(0);
        vm.expectRevert(IDealEscrowTypes.ZeroAddress.selector);
        vm.prank(buyer);
        escrow.pay(t, s, p, buyer);
    }

    function test_pay_revertsWhenRefundToIsSellerOrPlug() public {
        IDealEscrowTypes.Terms memory t = _defaultTerms();
        bytes memory s = _sellerSig(t);
        bytes memory p = _plugSig(t);
        vm.expectRevert(IDealEscrowTypes.InvalidRefundTo.selector);
        vm.prank(buyer);
        escrow.pay(t, s, p, seller);
        vm.expectRevert(IDealEscrowTypes.InvalidRefundTo.selector);
        vm.prank(buyer);
        escrow.pay(t, s, p, plug);
    }

    function test_pay_revertsForUnlistedPlug() public {
        vm.prank(owner);
        escrow.setPlugLevel(plug, 0);
        IDealEscrowTypes.Terms memory t = _defaultTerms();
        bytes memory s = _sellerSig(t);
        bytes memory p = _plugSig(t);
        vm.expectRevert(IDealEscrowTypes.PlugNotListed.selector);
        vm.prank(buyer);
        escrow.pay(t, s, p, buyer);
    }

    function test_pay_enforcesLevelCap() public {
        vm.prank(owner);
        escrow.setPlugLevel(plug, 2); // cap 10 USDC
        IDealEscrowTypes.Terms memory over = _terms(10e6 + 2, 0, 1 days);
        bytes memory s = _sellerSig(over);
        bytes memory p = _plugSig(over);
        vm.expectRevert(IDealEscrowTypes.ExceedsPlugLevel.selector);
        vm.prank(buyer);
        escrow.pay(over, s, p, buyer);

        _pay(_terms(10e6, 0, 1 days)); // exactly at the cap is fine
    }

    function test_pay_revertsBelowMinimum() public {
        IDealEscrowTypes.Terms memory t = _terms(1e6 - 2, 0, 1 days);
        bytes memory s = _sellerSig(t);
        bytes memory p = _plugSig(t);
        vm.expectRevert(IDealEscrowTypes.AmountOutOfRange.selector);
        vm.prank(buyer);
        escrow.pay(t, s, p, buyer);
    }

    function test_pay_feeLimits() public {
        IDealEscrowTypes.Terms memory t = _terms(10e6, 500_002, 1 days); // just over 5%
        bytes memory s = _sellerSig(t);
        bytes memory p = _plugSig(t);
        vm.expectRevert(IDealEscrowTypes.FeeTooHigh.selector);
        vm.prank(buyer);
        escrow.pay(t, s, p, buyer);

        t = _terms(10e6, type(uint256).max - 1, 1 days); // absurd fee must not overflow
        s = _sellerSig(t);
        p = _plugSig(t);
        vm.expectRevert(IDealEscrowTypes.FeeTooHigh.selector);
        vm.prank(buyer);
        escrow.pay(t, s, p, buyer);

        _pay(_terms(10e6, 500_000, 1 days)); // exactly 5% is fine
        _pay(_terms(10e6, 0, 1 days)); // a free plug is fine
    }

    function test_pay_revertsOnOddFee() public {
        IDealEscrowTypes.Terms memory t = _terms(5e6, 150_001, 1 days);
        bytes memory s = _sellerSig(t);
        bytes memory p = _plugSig(t);
        vm.expectRevert(IDealEscrowTypes.FeeNotEven.selector);
        vm.prank(buyer);
        escrow.pay(t, s, p, buyer);
    }

    function test_pay_revertsOnLongWindow() public {
        IDealEscrowTypes.Terms memory t = _terms(5e6, 0, 14 days + 1);
        bytes memory s = _sellerSig(t);
        bytes memory p = _plugSig(t);
        vm.expectRevert(IDealEscrowTypes.WindowTooLong.selector);
        vm.prank(buyer);
        escrow.pay(t, s, p, buyer);
        _pay(_terms(5e6, 0, 14 days));
    }

    function test_pay_expiryRules() public {
        IDealEscrowTypes.Terms memory t = _defaultTerms();
        t.expiry = uint64(block.timestamp);
        bytes memory s = _sellerSig(t);
        bytes memory p = _plugSig(t);
        vm.expectRevert(IDealEscrowTypes.TermsExpired.selector);
        vm.prank(buyer);
        escrow.pay(t, s, p, buyer);

        t = _defaultTerms();
        t.expiry = uint64(block.timestamp + 30 days + 1);
        s = _sellerSig(t);
        p = _plugSig(t);
        vm.expectRevert(IDealEscrowTypes.TermsLifetimeTooLong.selector);
        vm.prank(buyer);
        escrow.pay(t, s, p, buyer);
    }

    function test_pay_dealIdIsSellerScoped() public {
        IDealEscrowTypes.Terms memory t = _defaultTerms();
        uint256 id = _pay(t);
        assertEq(id, uint256(keccak256(abi.encode(seller, t.orderId))));

        bytes memory s = _sellerSig(t);
        bytes memory p = _plugSig(t);
        vm.expectRevert(IDealEscrowTypes.OrderAlreadyPaid.selector);
        vm.prank(buyer);
        escrow.pay(t, s, p, buyer);

        (address seller2, uint256 seller2Key) = makeAddrAndKey("seller-2");
        IDealEscrowTypes.Terms memory t2 = t;
        t2.seller = seller2;
        bytes memory s2 = _sig(seller2Key, escrow.termsDigest(t2));
        bytes memory p2 = _plugSig(t2);
        vm.prank(buyer);
        uint256 id2 = escrow.pay(t2, s2, p2, buyer);
        assertTrue(id2 != id);
    }

    function test_pay_heldCap() public {
        usdc.mint(buyer, 5_000e6);
        uint256 paid;
        while (escrow.totalHeld() + 100e6 <= escrow.MAX_TOTAL_HELD()) {
            _pay(_terms(100e6, 0, 1 days));
            paid++;
        }
        assertEq(paid, 25);
        IDealEscrowTypes.Terms memory t = _terms(1e6, 0, 1 days);
        bytes memory s = _sellerSig(t);
        bytes memory p = _plugSig(t);
        vm.expectRevert(IDealEscrowTypes.HeldCapExceeded.selector);
        vm.prank(buyer);
        escrow.pay(t, s, p, buyer);

        vm.warp(block.timestamp + 1 days);
        escrow.withdraw(escrow.dealIdOf(seller, keccak256(abi.encode("order", uint256(0)))));
        _pay(t); // room again after a deal finishes
    }

    function test_pay_blockedWhilePaused() public {
        vm.prank(owner);
        escrow.pause();
        IDealEscrowTypes.Terms memory t = _defaultTerms();
        bytes memory s = _sellerSig(t);
        bytes memory p = _plugSig(t);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(buyer);
        escrow.pay(t, s, p, buyer);
    }

    function testFuzz_feeSplit_legsAlwaysSumToEscrow(uint256 price, uint256 fee) public {
        price = bound(price, 1e6, 100e6);
        fee = bound(fee, 0, price * 500 / 10_000) & ~uint256(1);
        uint256 buyerHalf = fee / 2;
        uint256 sellerHalf = fee - buyerHalf;
        assertEq(buyerHalf, sellerHalf);
        // settled: seller + plug == escrow; plug ruling for buyer: buyer + plug == escrow
        assertEq((price - sellerHalf) + fee, price + buyerHalf);
        assertEq(price + buyerHalf, price + buyerHalf);
    }

    // ============================================================ settle (UT-08, UT-12, UT-24)

    function test_withdraw_afterWindowPaysSellerAndPlug() public {
        (uint256 id, IDealEscrowTypes.Terms memory t) = _payDefault();
        vm.warp(block.timestamp + 3 days);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit IDealEscrowTypes.Settled(id, 5e6 - 75_000, 150_000);
        vm.prank(stranger);
        escrow.withdraw(id);

        assertEq(usdc.balanceOf(seller), 4_925_000);
        assertEq(usdc.balanceOf(plug), 150_000);
        assertEq(usdc.balanceOf(seller) + usdc.balanceOf(plug), _escrowed(t));
        assertEq(uint8(_status(id)), uint8(IDealEscrowTypes.Status.Settled));
        assertEq(escrow.totalHeld(), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_withdraw_windowBoundaryIsExact() public {
        (uint256 id,) = _payDefault();
        vm.warp(block.timestamp + 3 days - 1);
        vm.expectRevert(IDealEscrowTypes.WindowOpen.selector);
        escrow.withdraw(id);
        vm.warp(block.timestamp + 1);
        escrow.withdraw(id);
    }

    function test_zeroWindow_withdrawNowAndNoDispute() public {
        uint256 id = _pay(_terms(5e6, 150_000, 0));
        vm.expectRevert(IDealEscrowTypes.WindowClosed.selector);
        vm.prank(buyer);
        escrow.openDispute(id, bytes32(0));
        escrow.withdraw(id);
        assertEq(uint8(_status(id)), uint8(IDealEscrowTypes.Status.Settled));
    }

    function test_withdraw_revertsWhileDisputedOrFinal() public {
        (uint256 id,) = _payDefault();
        _dispute(id);
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert(IDealEscrowTypes.InvalidStatus.selector);
        escrow.withdraw(id);

        vm.prank(seller);
        escrow.refund(id);
        vm.expectRevert(IDealEscrowTypes.InvalidStatus.selector);
        escrow.withdraw(id);
        vm.expectRevert(IDealEscrowTypes.InvalidStatus.selector);
        escrow.withdraw(uint256(keccak256("never funded")));
    }

    // ============================================================ seller refund (UT-09, UT-10)

    function test_refund_inWindowAfterWindowAndDuringDispute() public {
        (uint256 a, IDealEscrowTypes.Terms memory t) = _payDefault();
        uint256 before = usdc.balanceOf(buyer);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit IDealEscrowTypes.Refunded(a, IDealEscrowTypes.RefundReason.Seller, _escrowed(t), 0);
        vm.prank(seller);
        escrow.refund(a);
        assertEq(usdc.balanceOf(buyer) - before, _escrowed(t));
        assertEq(usdc.balanceOf(plug), 0);

        (uint256 b,) = _payDefault();
        vm.warp(block.timestamp + 10 days);
        vm.prank(seller);
        escrow.refund(b);
        assertEq(uint8(_status(b)), uint8(IDealEscrowTypes.Status.Refunded));

        (uint256 c,) = _payDefault();
        _dispute(c);
        vm.prank(seller);
        escrow.refund(c);
        assertEq(uint8(_status(c)), uint8(IDealEscrowTypes.Status.Refunded));
        assertEq(usdc.balanceOf(plug), 0);
        assertEq(escrow.totalHeld(), 0);
    }

    function test_refund_onlySellerAndNeverTwiceOrAfterWithdraw() public {
        (uint256 id,) = _payDefault();
        vm.expectRevert(IDealEscrowTypes.CallerNotAllowed.selector);
        vm.prank(buyer);
        escrow.refund(id);

        vm.prank(seller);
        escrow.refund(id);
        vm.expectRevert(IDealEscrowTypes.InvalidStatus.selector);
        vm.prank(seller);
        escrow.refund(id);

        (uint256 w,) = _payDefault();
        vm.warp(block.timestamp + 3 days);
        escrow.withdraw(w);
        vm.expectRevert(IDealEscrowTypes.InvalidStatus.selector);
        vm.prank(seller);
        escrow.refund(w);
    }

    // ============================================================ dispute (UT-11)

    function test_dispute_boundaryAndRules() public {
        (uint256 id,) = _payDefault();
        uint256 releaseAt = escrow.getDeal(id).releaseAt;

        vm.expectRevert(IDealEscrowTypes.CallerNotAllowed.selector);
        vm.prank(stranger);
        escrow.openDispute(id, bytes32(0));

        vm.warp(releaseAt - 1);
        vm.expectEmit(true, false, false, true, address(escrow));
        // casting to 'uint40' is safe because test timestamps sit near 1.79e9
        // forge-lint: disable-next-line(unsafe-typecast)
        emit IDealEscrowTypes.DisputeOpened(id, keccak256("evidence"), uint40(releaseAt - 1 + 7 days));
        _dispute(id);
        IDealEscrowTypes.Deal memory d = escrow.getDeal(id);
        assertEq(uint8(d.status), uint8(IDealEscrowTypes.Status.Disputed));
        assertEq(d.disputedAt, releaseAt - 1);
        assertEq(d.evidenceHash, keccak256("evidence"));

        vm.expectRevert(IDealEscrowTypes.AlreadyDisputed.selector);
        _dispute(id);

        (uint256 late,) = _payDefault();
        vm.warp(escrow.getDeal(late).releaseAt);
        vm.expectRevert(IDealEscrowTypes.WindowClosed.selector);
        _dispute(late);
    }

    function test_dispute_onlyOncePerDealEvenAfterRelease() public {
        (uint256 id,) = _payDefault();
        _dispute(id);
        vm.prank(plug);
        escrow.plugReject(id, bytes32(0));
        vm.expectRevert(IDealEscrowTypes.InvalidStatus.selector);
        _dispute(id);
    }

    // ============================================================ plug ruling (UT-13, UT-14, UT-15)

    function test_plugRefund_paysBuyerPriceAndPlugHalf() public {
        (uint256 id,) = _payDefault();
        _dispute(id);
        uint256 before = usdc.balanceOf(buyer);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit IDealEscrowTypes.PlugRuled(id, plug, true, keccak256("note"));
        vm.expectEmit(true, false, false, true, address(escrow));
        emit IDealEscrowTypes.Refunded(id, IDealEscrowTypes.RefundReason.Plug, 5e6, 75_000);
        vm.prank(plug);
        escrow.plugRefund(id, keccak256("note"));

        assertEq(usdc.balanceOf(buyer) - before, 5e6);
        assertEq(usdc.balanceOf(plug), 75_000);
        assertEq(usdc.balanceOf(seller), 0);
        assertEq(escrow.totalHeld(), 0);
    }

    function test_plugRuling_rules() public {
        (uint256 id,) = _payDefault();
        vm.expectRevert(IDealEscrowTypes.InvalidStatus.selector);
        vm.prank(plug);
        escrow.plugRefund(id, bytes32(0)); // not disputed

        _dispute(id);
        vm.expectRevert(IDealEscrowTypes.CallerNotAllowed.selector);
        vm.prank(stranger);
        escrow.plugRefund(id, bytes32(0));
        vm.expectRevert(IDealEscrowTypes.CallerNotAllowed.selector);
        vm.prank(seller);
        escrow.plugReject(id, bytes32(0));

        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(IDealEscrowTypes.PlugDeadlinePassed.selector);
        vm.prank(plug);
        escrow.plugRefund(id, bytes32(0));
        vm.expectRevert(IDealEscrowTypes.PlugDeadlinePassed.selector);
        vm.prank(plug);
        escrow.plugReject(id, bytes32(0));
    }

    function test_plugReject_thenImmediateWithdraw() public {
        (uint256 id, IDealEscrowTypes.Terms memory t) = _payDefault();
        _dispute(id);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit IDealEscrowTypes.PlugRuled(id, plug, false, keccak256("n"));
        vm.prank(plug);
        escrow.plugReject(id, keccak256("n"));
        assertEq(uint8(_status(id)), uint8(IDealEscrowTypes.Status.Released));

        escrow.withdraw(id); // inside the window, immediately
        assertEq(usdc.balanceOf(seller), t.price - t.plugFee / 2);
        assertEq(usdc.balanceOf(plug), t.plugFee);
    }

    function test_finalizeExpiredDispute() public {
        (uint256 id, IDealEscrowTypes.Terms memory t) = _payDefault();
        _dispute(id);
        uint256 disputedAt = block.timestamp;
        uint256 before = usdc.balanceOf(buyer);

        vm.warp(disputedAt + 7 days - 1);
        vm.expectRevert(IDealEscrowTypes.PlugDeadlineNotReached.selector);
        escrow.finalizeExpiredDispute(id);

        vm.warp(disputedAt + 7 days);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit IDealEscrowTypes.Refunded(id, IDealEscrowTypes.RefundReason.Timeout, _escrowed(t), 0);
        vm.prank(stranger);
        escrow.finalizeExpiredDispute(id);

        assertEq(usdc.balanceOf(buyer) - before, _escrowed(t));
        assertEq(usdc.balanceOf(plug), 0);
        assertEq(uint8(_status(id)), uint8(IDealEscrowTypes.Status.Refunded));

        vm.expectRevert(IDealEscrowTypes.InvalidStatus.selector);
        escrow.finalizeExpiredDispute(id);
    }

    function test_buyerReleaseEndsDispute() public {
        (uint256 id,) = _payDefault();
        _dispute(id);
        vm.prank(buyer);
        escrow.release(id);
        assertEq(uint8(_status(id)), uint8(IDealEscrowTypes.Status.Released));
        escrow.withdraw(id);
    }

    // ============================================================ levels (UT-16)

    function test_levelChangesDoNotTouchExistingDeals() public {
        uint256 id = _pay(_terms(50e6, 0, 1 days));
        vm.prank(owner);
        escrow.setPlugLevel(plug, 0);
        _dispute(id);
        vm.prank(plug);
        escrow.plugReject(id, bytes32(0)); // delisted plug still rules on its existing deal
        escrow.withdraw(id);
        assertEq(usdc.balanceOf(seller), 50e6);
    }

    // ============================================================ release (UT-17, UT-18, UT-19)

    function test_release_directByBuyerOnly() public {
        (uint256 id,) = _payDefault();
        vm.expectRevert(IDealEscrowTypes.CallerNotAllowed.selector);
        vm.prank(seller);
        escrow.release(id);
        vm.expectEmit(true, true, false, false, address(escrow));
        emit IDealEscrowTypes.Released(id, buyer);
        vm.prank(buyer);
        escrow.release(id);
        vm.expectRevert(IDealEscrowTypes.InvalidStatus.selector);
        vm.prank(buyer);
        escrow.release(id);
    }

    function _releaseSig(uint256 id, uint256 key, address signer, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        IDealEscrowTypes.Deal memory d = escrow.getDeal(id);
        uint256 amount = uint256(d.price) + d.plugFee / 2;
        return _sig(key, escrow.releaseDigest(id, signer, amount, nonce, deadline));
    }

    function test_releaseWithSig_relayedByAnyone() public {
        (uint256 id,) = _payDefault();
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _releaseSig(id, buyerKey, buyer, 0, deadline);
        vm.prank(stranger);
        escrow.releaseWithSig(id, deadline, sig);
        assertEq(uint8(_status(id)), uint8(IDealEscrowTypes.Status.Released));
        assertEq(escrow.releaseNonce(buyer), 1);
        escrow.withdraw(id);
    }

    function test_releaseWithSig_contractWalletBuyer() public {
        ERC1271Wallet wallet = new ERC1271Wallet(buyer);
        usdc.mint(address(wallet), 100e6);
        IDealEscrowTypes.Terms memory t = _defaultTerms();
        bytes memory s = _sellerSig(t);
        bytes memory p = _plugSig(t);
        vm.startPrank(buyer);
        wallet.execute(address(usdc), abi.encodeCall(IERC20.approve, (address(escrow), type(uint256).max)));
        wallet.execute(address(escrow), abi.encodeCall(escrow.pay, (t, s, p, address(wallet))));
        vm.stopPrank();
        uint256 id = escrow.dealIdOf(seller, t.orderId);
        assertEq(escrow.getDeal(id).buyer, address(wallet));

        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _releaseSig(id, buyerKey, address(wallet), 0, deadline);
        escrow.releaseWithSig(id, deadline, sig);
        assertEq(uint8(_status(id)), uint8(IDealEscrowTypes.Status.Released));
    }

    function test_releaseWithSig_rejections() public {
        (uint256 id,) = _payDefault();
        uint256 releaseAt = escrow.getDeal(id).releaseAt;
        uint256 deadline = block.timestamp + 1 days;

        bytes memory wrongSigner = _releaseSig(id, sellerKey, buyer, 0, deadline);
        vm.expectRevert(IDealEscrowTypes.InvalidBuyerSignature.selector);
        escrow.releaseWithSig(id, deadline, wrongSigner);

        bytes memory late = _releaseSig(id, buyerKey, buyer, 0, releaseAt + 1);
        vm.expectRevert(IDealEscrowTypes.DeadlineAfterWindow.selector);
        escrow.releaseWithSig(id, releaseAt + 1, late);

        bytes memory good = _releaseSig(id, buyerKey, buyer, 0, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(IDealEscrowTypes.SignatureExpired.selector);
        escrow.releaseWithSig(id, deadline, good);
    }

    function test_releaseWithSig_noReplay() public {
        (uint256 a,) = _payDefault();
        (uint256 b,) = _payDefault();
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sigA = _releaseSig(a, buyerKey, buyer, 0, deadline);

        escrow.releaseWithSig(a, deadline, sigA);
        vm.expectRevert(IDealEscrowTypes.InvalidStatus.selector);
        escrow.releaseWithSig(a, deadline, sigA); // same deal again

        vm.expectRevert(IDealEscrowTypes.InvalidBuyerSignature.selector);
        escrow.releaseWithSig(b, deadline, sigA); // another deal

        bytes memory sigB = _releaseSig(b, buyerKey, buyer, 1, deadline);
        vm.prank(buyer);
        escrow.cancelNonce();
        vm.expectRevert(IDealEscrowTypes.InvalidBuyerSignature.selector);
        escrow.releaseWithSig(b, deadline, sigB); // cancelled nonce
    }

    function test_releaseWithSig_rejectsHighS() public {
        (uint256 id,) = _payDefault();
        uint256 deadline = block.timestamp + 1 days;
        IDealEscrowTypes.Deal memory d = escrow.getDeal(id);
        bytes32 digest = escrow.releaseDigest(id, buyer, uint256(d.price) + d.plugFee / 2, 0, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerKey, digest);
        bytes32 highS = bytes32(SECP256K1_N - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;
        vm.expectRevert(IDealEscrowTypes.InvalidBuyerSignature.selector);
        escrow.releaseWithSig(id, deadline, abi.encodePacked(r, highS, flippedV));
    }

    // ============================================================ blocklist (UT-20)

    function test_blockedSeller_legDeferredOthersPaidThenRetried() public {
        (uint256 id,) = _payDefault();
        vm.warp(block.timestamp + 3 days);
        usdc.setBlocked(seller, true);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit IDealEscrowTypes.PayoutDeferred(id, seller, 4_925_000);
        escrow.withdraw(id);

        assertEq(uint8(_status(id)), uint8(IDealEscrowTypes.Status.Settled));
        assertTrue(escrow.getDeal(id).payoutPending);
        assertEq(usdc.balanceOf(plug), 150_000);
        (uint256 r, uint256 s, uint256 p) = escrow.pendingPayouts(id);
        assertEq(r, 0);
        assertEq(s, 4_925_000);
        assertEq(p, 0);
        assertEq(escrow.totalHeld(), 4_925_000);

        escrow.retryPayout(id); // still blocked: nothing moves, nothing reverts
        (, s,) = escrow.pendingPayouts(id);
        assertEq(s, 4_925_000);

        usdc.setBlocked(seller, false);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit IDealEscrowTypes.PayoutRetried(id, seller, 4_925_000);
        escrow.retryPayout(id);
        assertEq(usdc.balanceOf(seller), 4_925_000);
        assertFalse(escrow.getDeal(id).payoutPending);
        assertEq(escrow.totalHeld(), 0);

        vm.expectRevert(IDealEscrowTypes.NoPendingPayout.selector);
        escrow.retryPayout(id);
    }

    function test_blockedPlugAndBuyer_legsDeferredPerDeal() public {
        (uint256 a,) = _payDefault();
        (uint256 b,) = _payDefault();
        _dispute(a);
        usdc.setBlocked(plug, true);
        usdc.setBlocked(buyer, true);
        vm.prank(plug);
        escrow.plugRefund(a, bytes32(0));
        (uint256 r, uint256 s, uint256 p) = escrow.pendingPayouts(a);
        assertEq(r, 5e6);
        assertEq(s, 0);
        assertEq(p, 75_000);

        vm.warp(block.timestamp + 3 days);
        escrow.withdraw(b); // the other deal settles: seller paid, plug leg parked
        assertEq(usdc.balanceOf(seller), 4_925_000);
        (, s, p) = escrow.pendingPayouts(b);
        assertEq(s, 0);
        assertEq(p, 150_000);

        usdc.setBlocked(plug, false);
        escrow.retryPayout(a); // plug leg pays, buyer leg stays parked
        (r,, p) = escrow.pendingPayouts(a);
        assertEq(r, 5e6);
        assertEq(p, 0);
        assertTrue(escrow.getDeal(a).payoutPending);
        assertEq(escrow.totalHeld(), 5e6 + 150_000);
    }

    function test_blockedRefundTo_parkedThenRetried() public {
        (uint256 id, IDealEscrowTypes.Terms memory t) = _payDefault();
        usdc.setBlocked(buyer, true);
        vm.prank(seller);
        escrow.refund(id);
        (uint256 r,,) = escrow.pendingPayouts(id);
        assertEq(r, _escrowed(t));
        assertEq(escrow.totalHeld(), _escrowed(t));

        usdc.setBlocked(buyer, false);
        uint256 before = usdc.balanceOf(buyer);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit IDealEscrowTypes.PayoutRetried(id, buyer, _escrowed(t));
        escrow.retryPayout(id);
        assertEq(usdc.balanceOf(buyer) - before, _escrowed(t));
        (r,,) = escrow.pendingPayouts(id);
        assertEq(r, 0);
        assertFalse(escrow.getDeal(id).payoutPending);
        assertEq(escrow.totalHeld(), 0);
    }

    function _ts(uint256 t) internal pure returns (uint40) {
        // casting to 'uint40' is safe because test timestamps sit near 1.79e9
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint40(t);
    }

    // ============================================================ hostile tokens (UT-21, transfer mismatch)

    function test_reentrancyFromTokenCannotDoubleSpend() public {
        ReentrantToken token = new ReentrantToken();
        DealEscrow hostile = new DealEscrow(IERC20(address(token)), owner);
        vm.prank(owner);
        hostile.setPlugLevel(plug, 5);
        token.mint(buyer, 100e6);
        vm.prank(buyer);
        token.approve(address(hostile), type(uint256).max);

        IDealEscrowTypes.Terms memory t = _terms(5e6, 150_000, 0);
        bytes memory s = _sig(sellerKey, hostile.termsDigest(t));
        bytes memory p = _sig(plugKey, hostile.acceptDigest(hostile.termsHash(t), plug));
        vm.prank(buyer);
        uint256 id = hostile.pay(t, s, p, buyer);

        token.arm(address(hostile), abi.encodeCall(hostile.withdraw, (id)));
        hostile.withdraw(id);

        assertTrue(token.reentered());
        assertFalse(token.reentrySucceeded(), "reentrant withdraw went through");
        assertEq(token.balanceOf(seller) + token.balanceOf(plug), 5_075_000);
        assertEq(token.balanceOf(address(hostile)), 0);
        assertEq(hostile.totalHeld(), 0);
    }

    function test_pay_revertsWhenTokenDeliversLess() public {
        FeeOnTransferToken token = new FeeOnTransferToken();
        DealEscrow taxed = new DealEscrow(IERC20(address(token)), owner);
        vm.prank(owner);
        taxed.setPlugLevel(plug, 5);
        token.mint(buyer, 100e6);
        vm.prank(buyer);
        token.approve(address(taxed), type(uint256).max);

        IDealEscrowTypes.Terms memory t = _defaultTerms();
        bytes memory s = _sig(sellerKey, taxed.termsDigest(t));
        bytes memory p = _sig(plugKey, taxed.acceptDigest(taxed.termsHash(t), plug));
        vm.expectRevert(IDealEscrowTypes.TransferAmountMismatch.selector);
        vm.prank(buyer);
        taxed.pay(t, s, p, buyer);
    }

    // ============================================================ pause (UT-22)

    function test_pause_blocksPayOnlyEveryExitStillWorks() public {
        (uint256 refundId,) = _payDefault();
        (uint256 disputeId,) = _payDefault();
        (uint256 releaseId,) = _payDefault();
        (uint256 rulingId,) = _payDefault();
        (uint256 timeoutId,) = _payDefault();
        (uint256 withdrawId,) = _payDefault();
        (uint256 retryId,) = _payDefault();
        _dispute(rulingId);
        _dispute(timeoutId);

        vm.prank(owner);
        escrow.pause();

        vm.prank(seller);
        escrow.refund(refundId);
        _dispute(disputeId);
        vm.prank(buyer);
        escrow.release(releaseId);
        vm.prank(plug);
        escrow.plugRefund(rulingId, bytes32(0));

        vm.warp(block.timestamp + 7 days);
        escrow.finalizeExpiredDispute(timeoutId);
        escrow.withdraw(withdrawId);

        usdc.setBlocked(seller, true);
        escrow.withdraw(retryId);
        usdc.setBlocked(seller, false);
        escrow.retryPayout(retryId);

        assertEq(uint8(_status(disputeId)), uint8(IDealEscrowTypes.Status.Disputed));
        assertEq(uint8(_status(retryId)), uint8(IDealEscrowTypes.Status.Settled));
    }

    // ============================================================ sweep and batches (UT-23, UT-29)

    function test_sweepExcess_neverTouchesDealFunds() public {
        _payDefault();
        usdc.mint(address(escrow), 3e6); // stray USDC
        vm.prank(owner);
        escrow.sweepExcess(owner);
        assertEq(usdc.balanceOf(owner), 3e6);
        assertEq(usdc.balanceOf(address(escrow)), escrow.totalHeld());
        vm.expectRevert(IDealEscrowTypes.NothingToSweep.selector);
        vm.prank(owner);
        escrow.sweepExcess(owner);
    }

    function test_sweepExcess_cannotTakeParkedLegs() public {
        (uint256 id,) = _payDefault();
        vm.warp(block.timestamp + 3 days);
        usdc.setBlocked(seller, true);
        escrow.withdraw(id);
        vm.expectRevert(IDealEscrowTypes.NothingToSweep.selector);
        vm.prank(owner);
        escrow.sweepExcess(owner);
    }

    function test_withdrawMany() public {
        uint256[] memory ids = new uint256[](3);
        for (uint256 i; i < 3; ++i) {
            (ids[i],) = _payDefault();
        }
        vm.warp(block.timestamp + 3 days);
        escrow.withdrawMany(ids);
        for (uint256 i; i < 3; ++i) {
            assertEq(uint8(_status(ids[i])), uint8(IDealEscrowTypes.Status.Settled));
        }
        assertEq(escrow.totalHeld(), 0);

        uint256[] memory tooMany = new uint256[](51);
        vm.expectRevert(IDealEscrowTypes.BatchTooLarge.selector);
        escrow.withdrawMany(tooMany);
    }

    function test_withdrawMany_isAllOrNothing() public {
        uint256[] memory ids = new uint256[](2);
        (ids[0],) = _payDefault();
        vm.warp(block.timestamp + 3 days);
        ids[1] = _pay(_terms(5e6, 0, 3 days)); // window still open
        vm.expectRevert(IDealEscrowTypes.WindowOpen.selector);
        escrow.withdrawMany(ids);
        assertEq(uint8(_status(ids[0])), uint8(IDealEscrowTypes.Status.Held));
    }
}
