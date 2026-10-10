// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Test, Vm} from "forge-std/Test.sol";

import {DealEscrow} from "../../src/DealEscrow.sol";
import {IDealEscrowTypes} from "../../src/interfaces/IDealEscrowTypes.sol";

interface IMulticall3From {
    struct Call3 {
        address target;
        bool allowFailure;
        bytes callData;
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    function aggregate3(Call3[] calldata calls) external payable returns (Result[] memory);
}

interface IMemo {
    event Memo(
        address indexed sender,
        address indexed target,
        bytes32 callDataHash,
        bytes32 indexed memoId,
        bytes memo,
        uint256 memoIndex
    );

    function memo(address target, bytes calldata data, bytes32 memoId, bytes calldata memoData) external;
}

/// @notice DealEscrow against Arc's real USDC system contract, Memo and Multicall3From on a testnet fork.
///         Run with: make test-arc  (arc-forge --network arc --fork-url https://rpc.testnet.arc.io)
contract ArcDealEscrowTest is Test {
    IERC20 internal constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    address internal constant MEMO = 0x5294E9927c3306DcBaDb03fe70b92e01cCede505;
    address internal constant MULTICALL3FROM = 0x522fAf9A91c41c443c66765030741e4AaCe147D0;
    /// @dev Arc's native-coin control contract; the blocklist flag lives at keccak256(abi.encode(account, 2)).
    address internal constant NATIVE_COIN_CONTROL = address(uint160((uint256(0x18) << 152) | 1));

    DealEscrow internal escrow;
    address internal owner = makeAddr("arc-owner");
    address internal seller;
    uint256 internal sellerKey;
    address internal plug;
    uint256 internal plugKey;
    address internal buyer;
    uint256 internal orderNonce;

    function setUp() public {
        (seller, sellerKey) = makeAddrAndKey("arc-seller");
        (plug, plugKey) = makeAddrAndKey("arc-plug");
        buyer = makeAddr("arc-buyer");
        escrow = new DealEscrow(USDC, owner);
        vm.prank(owner);
        escrow.setPlugLevel(plug, 5);
        vm.deal(buyer, 500 ether); // 500 USDC at 18 native decimals
    }

    function _blocklist(address account, bool blocked) internal {
        vm.store(NATIVE_COIN_CONTROL, keccak256(abi.encode(account, uint256(2))), bytes32(uint256(blocked ? 1 : 0)));
    }

    function _terms(uint256 price, uint256 fee, uint32 window) internal returns (IDealEscrowTypes.Terms memory) {
        return IDealEscrowTypes.Terms({
            seller: seller,
            plug: plug,
            orderId: keccak256(abi.encode("arc-order", orderNonce++)),
            price: price,
            plugFee: fee,
            windowSeconds: window,
            expiry: uint64(block.timestamp + 1 days),
            metadataHash: keccak256("arc job")
        });
    }

    function _sigs(IDealEscrowTypes.Terms memory t) internal view returns (bytes memory s, bytes memory p) {
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(sellerKey, escrow.termsDigest(t));
        s = abi.encodePacked(r, ss, v);
        (v, r, ss) = vm.sign(plugKey, escrow.acceptDigest(escrow.termsHash(t), plug));
        p = abi.encodePacked(r, ss, v);
    }

    function _pay(IDealEscrowTypes.Terms memory t) internal returns (uint256 id) {
        (bytes memory s, bytes memory p) = _sigs(t);
        vm.startPrank(buyer);
        USDC.approve(address(escrow), type(uint256).max);
        id = escrow.pay(t, s, p, buyer);
        vm.stopPrank();
    }

    /// ARC-06a: fund, settle, and the 6-decimal accounting lines up with Arc's native balance.
    function test_arc_payAndSettleWithRealUsdc() public {
        uint256 buyerBefore = USDC.balanceOf(buyer);
        uint256 id = _pay(_terms(5e6, 150_000, 1 hours));
        assertEq(USDC.balanceOf(address(escrow)), 5_075_000);
        assertEq(address(escrow).balance, 5_075_000 * 1e12, "native view disagrees with ERC-20 view");
        assertEq(buyerBefore - USDC.balanceOf(buyer), 5_075_000);

        vm.warp(block.timestamp + 1 hours);
        escrow.withdraw(id);
        assertEq(USDC.balanceOf(seller), 4_925_000);
        assertEq(USDC.balanceOf(plug), 150_000);
        assertEq(USDC.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalHeld(), 0);
    }

    /// ARC-06b: a blocklisted seller's leg is parked, the plug is still paid, and the retry pays after unblocking.
    function test_arc_blocklistedSellerParkedThenRetried() public {
        uint256 id = _pay(_terms(10e6, 300_000, 1 hours));
        vm.warp(block.timestamp + 1 hours);
        _blocklist(seller, true);

        escrow.withdraw(id);
        assertEq(uint8(escrow.getDeal(id).status), uint8(IDealEscrowTypes.Status.Settled));
        assertTrue(escrow.getDeal(id).payoutPending);
        assertEq(USDC.balanceOf(seller), 0);
        assertEq(USDC.balanceOf(plug), 300_000);
        (, uint256 parked,) = escrow.pendingPayouts(id);
        assertEq(parked, 9_850_000);
        assertEq(escrow.totalHeld(), 9_850_000);
        assertEq(USDC.balanceOf(address(escrow)), 9_850_000);

        escrow.retryPayout(id); // still blocked: no revert, nothing moves
        assertEq(USDC.balanceOf(seller), 0);

        _blocklist(seller, false);
        escrow.retryPayout(id);
        assertEq(USDC.balanceOf(seller), 9_850_000);
        assertFalse(escrow.getDeal(id).payoutPending);
        assertEq(escrow.totalHeld(), 0);
    }

    /// ARC-06c: dispute, plug rules for the buyer, the refund goes to the fixed refund address.
    function test_arc_disputeAndPlugRefund() public {
        uint256 id = _pay(_terms(25e6, 750_000, 2 days));
        uint256 buyerBefore = USDC.balanceOf(buyer);
        vm.prank(buyer);
        escrow.openDispute(id, keccak256("evidence"));
        vm.prank(plug);
        escrow.plugRefund(id, keccak256("note"));
        assertEq(USDC.balanceOf(buyer) - buyerBefore, 25e6);
        assertEq(USDC.balanceOf(plug), 375_000);
        assertEq(escrow.totalHeld(), 0);
    }

    /// ARC-06d: a blocklisted buyer cannot fund a deal (the pull reverts and nothing is recorded).
    function test_arc_blocklistedBuyerCannotFund() public {
        IDealEscrowTypes.Terms memory t = _terms(5e6, 0, 1 hours);
        (bytes memory s, bytes memory p) = _sigs(t);
        vm.prank(buyer);
        USDC.approve(address(escrow), type(uint256).max);
        _blocklist(buyer, true);
        vm.prank(buyer);
        vm.expectRevert();
        escrow.pay(t, s, p, buyer);
        assertEq(uint8(escrow.getDeal(escrow.dealIdOf(seller, t.orderId)).status), 0);
        assertEq(escrow.totalHeld(), 0);
    }

    /// ARC-08: the keeper decides whether a parked leg is worth retrying by simulating USDC.transfer from the
    ///         escrow's address (an eth_call with from = escrow). On Arc's real USDC that simulation must fail
    ///         while the recipient is blocklisted and succeed once it is not.
    function test_arc_keeperRetryProbeMatchesBlocklist() public {
        uint256 id = _pay(_terms(5e6, 0, 0));
        _blocklist(seller, true);
        escrow.withdraw(id);
        (, uint256 parked,) = escrow.pendingPayouts(id);
        assertEq(parked, 5e6);

        uint256 snap = vm.snapshotState();
        vm.prank(address(escrow));
        (bool okBlocked,) = address(USDC).call(abi.encodeCall(IERC20.transfer, (seller, parked)));
        assertFalse(okBlocked, "probe says a blocklisted leg would pay");
        vm.revertToState(snap);

        _blocklist(seller, false);
        snap = vm.snapshotState();
        vm.prank(address(escrow));
        (bool okClear,) = address(USDC).call(abi.encodeCall(IERC20.transfer, (seller, parked)));
        assertTrue(okClear, "probe says an unblocked leg would still fail");
        vm.revertToState(snap); // a simulation moves nothing

        escrow.retryPayout(id);
        assertEq(USDC.balanceOf(seller), 5e6);
    }

    /// ARC-07: one wallet prompt: Multicall3From batches approve + Memo-wrapped pay; the escrow sees the
    ///         buyer EOA as msg.sender and Arc records the order tag.
    function test_arc_oneClickPayThroughMulticall3FromAndMemo() public {
        IDealEscrowTypes.Terms memory t = _terms(5e6, 150_000, 1 hours);
        (bytes memory s, bytes memory p) = _sigs(t);
        bytes32 memoId = keccak256(abi.encodePacked("dealescrow:v1:", t.orderId));
        bytes memory payCall = abi.encodeCall(escrow.pay, (t, s, p, buyer));

        IMulticall3From.Call3[] memory calls = new IMulticall3From.Call3[](2);
        calls[0] = IMulticall3From.Call3({
            target: address(USDC),
            allowFailure: false,
            callData: abi.encodeCall(IERC20.approve, (address(escrow), 5_075_000))
        });
        calls[1] = IMulticall3From.Call3({
            target: MEMO,
            allowFailure: false,
            callData: abi.encodeCall(IMemo.memo, (address(escrow), payCall, memoId, ""))
        });

        vm.recordLogs();
        vm.prank(buyer, buyer); // msg.sender and tx.origin are the buyer EOA, as for a wallet-sent transaction
        IMulticall3From(MULTICALL3FROM).aggregate3(calls);

        uint256 id = escrow.dealIdOf(seller, t.orderId);
        IDealEscrowTypes.Deal memory d = escrow.getDeal(id);
        assertEq(uint8(d.status), uint8(IDealEscrowTypes.Status.Held));
        assertEq(d.buyer, buyer, "escrow did not see the buyer as msg.sender");
        assertEq(USDC.balanceOf(address(escrow)), 5_075_000);

        bool sawMemo;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == MEMO && logs[i].topics[0] == IMemo.Memo.selector) {
                assertEq(logs[i].topics[1], bytes32(uint256(uint160(buyer))), "memo sender");
                assertEq(logs[i].topics[2], bytes32(uint256(uint160(address(escrow)))), "memo target");
                assertEq(logs[i].topics[3], memoId, "memo id");
                sawMemo = true;
            }
        }
        assertTrue(sawMemo, "no Memo event");
    }

    /// ARC-07b: a relayed transaction (tx.origin is not the buyer) cannot tag through Memo, so the app must
    ///          fall back to plain calls for smart wallets and sponsored flows.
    function test_arc_memoRejectsRelayedSender() public {
        IDealEscrowTypes.Terms memory t = _terms(5e6, 0, 1 hours);
        (bytes memory s, bytes memory p) = _sigs(t);
        vm.prank(buyer);
        USDC.approve(address(escrow), type(uint256).max);
        bytes memory payCall = abi.encodeCall(escrow.pay, (t, s, p, buyer));
        address relayer = makeAddr("relayer");

        vm.prank(buyer, relayer);
        vm.expectRevert();
        IMemo(MEMO).memo(address(escrow), payCall, bytes32(0), "");
    }
}
