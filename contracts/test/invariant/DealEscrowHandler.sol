// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {DealEscrow} from "../../src/DealEscrow.sol";
import {IDealEscrowTypes} from "../../src/interfaces/IDealEscrowTypes.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @dev Drives DealEscrow with only calls that must succeed, and records ghost state for the invariants.
///      Runs with fail_on_revert, so any valid exit that reverts (paused, blocklisted party, odd timing)
///      fails the campaign.
contract DealEscrowHandler is Test {
    DealEscrow public immutable escrow;
    MockUSDC public immutable usdc;
    address public immutable owner;

    address[] public actors;
    uint256[] internal keys;

    uint256[] public dealIds;
    uint256 public orderNonce;

    // ghost state
    uint256 public totalMinted;
    mapping(uint256 => uint256) public outflow; // USDC that left the escrow for this deal
    mapping(uint256 => uint256) public plugReceived; // USDC the deal's plug actually received from it
    mapping(uint256 => uint8) public refundReason; // 1 seller, 2 plug, 3 timeout
    mapping(uint256 => uint8) public lastStatus;
    mapping(uint256 => uint8) public levelAtFunding;
    mapping(uint256 => IDealEscrowTypes.Deal) internal fundedSnapshot;
    bool public illegalTransition;
    bool public finalStatusChanged;

    mapping(bytes32 => uint256) internal _calls;

    function calls(bytes32 name) external view returns (uint256) {
        return _calls[name];
    }

    constructor(DealEscrow escrow_, MockUSDC usdc_, address owner_) {
        escrow = escrow_;
        usdc = usdc_;
        owner = owner_;
        for (uint256 i; i < 6; ++i) {
            (address a, uint256 k) = makeAddrAndKey(string(abi.encodePacked("actor", vm.toString(i))));
            actors.push(a);
            keys.push(k);
            usdc.mint(a, 1_000_000e6);
            totalMinted += 1_000_000e6;
            vm.prank(a);
            usdc.approve(address(escrow), type(uint256).max);
        }
        vm.startPrank(owner);
        escrow.setPlugLevel(actors[0], 5);
        escrow.setPlugLevel(actors[1], 3);
        escrow.setPlugLevel(actors[2], 1);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ helpers

    function dealCount() external view returns (uint256) {
        return dealIds.length;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function snapshot(uint256 id) external view returns (IDealEscrowTypes.Deal memory) {
        return fundedSnapshot[id];
    }

    function _deal(uint256 seed) internal view returns (uint256 id, IDealEscrowTypes.Deal memory d) {
        id = dealIds[seed % dealIds.length];
        d = escrow.getDeal(id);
    }

    enum Want {
        Disputable,
        Releasable,
        Rulable,
        Expired,
        Withdrawable,
        Retryable
    }

    /// @dev Scans from a random start for a deal that can take the action, so deep paths get exercised.
    function _find(uint256 seed, Want want)
        internal
        view
        returns (bool found, uint256 id, IDealEscrowTypes.Deal memory d)
    {
        uint256 n = dealIds.length;
        for (uint256 i; i < n; ++i) {
            id = dealIds[(seed % n + i) % n];
            d = escrow.getDeal(id);
            if (_eligible(id, d, want)) return (true, id, d);
        }
    }

    function _eligible(uint256 id, IDealEscrowTypes.Deal memory d, Want want) internal view returns (bool) {
        IDealEscrowTypes.Status s = d.status;
        if (want == Want.Disputable) return s == IDealEscrowTypes.Status.Held && block.timestamp < d.releaseAt;
        if (want == Want.Releasable) return s == IDealEscrowTypes.Status.Held || s == IDealEscrowTypes.Status.Disputed;
        if (want == Want.Rulable) {
            return
                s == IDealEscrowTypes.Status.Disputed && block.timestamp < uint256(d.disputedAt) + escrow.PLUG_WINDOW();
        }
        if (want == Want.Expired) {
            return
                s == IDealEscrowTypes.Status.Disputed && block.timestamp >= uint256(d.disputedAt) + escrow.PLUG_WINDOW();
        }
        if (want == Want.Withdrawable) {
            return s == IDealEscrowTypes.Status.Released
                || (s == IDealEscrowTypes.Status.Held && block.timestamp >= d.releaseAt);
        }
        (uint256 r, uint256 se, uint256 p) = escrow.pendingPayouts(id);
        return r + se + p != 0;
    }

    function _sig(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Wraps a state-changing call so ghost accounting sees exactly what moved for one deal.
    modifier track(uint256 id, bytes32 name) {
        IDealEscrowTypes.Deal memory before = escrow.getDeal(id);
        uint256 escrowBefore = usdc.balanceOf(address(escrow));
        uint256 plugBefore = usdc.balanceOf(before.plug);
        _;
        uint256 escrowAfter = usdc.balanceOf(address(escrow));
        if (escrowBefore > escrowAfter) outflow[id] += escrowBefore - escrowAfter;
        uint256 plugAfter = usdc.balanceOf(before.plug);
        if (plugAfter > plugBefore) plugReceived[id] += plugAfter - plugBefore;
        _recordTransition(id, uint8(before.status), uint8(escrow.getDeal(id).status));
        _calls[name]++;
    }

    function _recordTransition(uint256 id, uint8 from, uint8 to) internal {
        if (from >= 4 && to != from) finalStatusChanged = true; // Refunded=4, Settled=5
        if (from != to && !_allowed(from, to)) illegalTransition = true;
        lastStatus[id] = to;
    }

    function _allowed(uint8 from, uint8 to) internal pure returns (bool) {
        // None=0 Held=1 Disputed=2 Released=3 Refunded=4 Settled=5
        if (from == 0) return to == 1;
        if (from == 1) return to == 2 || to == 3 || to == 4 || to == 5;
        if (from == 2) return to == 3 || to == 4;
        if (from == 3) return to == 5;
        return false;
    }

    // ------------------------------------------------------------ actions

    function pay(uint256 sellerSeed, uint256 plugSeed, uint256 buyerSeed, uint256 price, uint256 fee, uint32 window)
        external
    {
        if (escrow.paused()) return;
        // Plugs are actors 0..2, sellers and buyers come from actors 3..5, so seats never collide.
        uint256 plugIdx = plugSeed % 3;
        address plug = actors[plugIdx];
        uint8 level = escrow.plugLevel(plug);
        for (uint256 i; level == 0 && i < 3; ++i) {
            plugIdx = (plugIdx + 1) % 3;
            plug = actors[plugIdx];
            level = escrow.plugLevel(plug);
        }
        if (level == 0) return;

        uint256 si = 3 + sellerSeed % 3;
        uint256 bi = 3 + (si - 3 + 1 + buyerSeed % 2) % 3;
        address seller = actors[si];
        address buyer = actors[bi];
        if (usdc.blocked(buyer)) buyer = actors[3 + (si - 3 + 1 + (1 - buyerSeed % 2)) % 3];
        if (usdc.blocked(buyer) || buyer == seller) return; // a blocklisted buyer cannot fund, by design

        // Mostly short windows so deals reach their end within a campaign; sometimes the full 14 days.
        window = uint32(window % 4 == 0 ? bound(window, 0, 14 days) : bound(window, 0, 2 days));
        price = bound(price, escrow.MIN_AMOUNT(), escrow.levelCap(level));
        fee = bound(fee, 0, price * 500 / 10_000) & ~uint256(1);
        if (escrow.totalHeld() + price + fee / 2 > escrow.MAX_TOTAL_HELD()) return;

        IDealEscrowTypes.Terms memory t = IDealEscrowTypes.Terms({
            seller: seller,
            plug: plug,
            orderId: bytes32(++orderNonce),
            price: price,
            plugFee: fee,
            windowSeconds: window,
            expiry: uint64(block.timestamp + 1 days),
            metadataHash: bytes32(0)
        });
        bytes memory s = _sig(keys[_indexOf(seller)], escrow.termsDigest(t));
        bytes memory p = _sig(keys[plugIdx], escrow.acceptDigest(escrow.termsHash(t), plug));

        vm.prank(buyer);
        uint256 id = escrow.pay(t, s, p, buyer);
        dealIds.push(id);
        levelAtFunding[id] = level;
        fundedSnapshot[id] = escrow.getDeal(id);
        _recordTransition(id, 0, 1);
        _calls[keccak256("pay")]++;
    }

    function openDispute(uint256 seed) external {
        (bool found, uint256 id, IDealEscrowTypes.Deal memory d) = _find(seed, Want.Disputable);
        if (!found) return;
        _openDispute(id, d.buyer);
    }

    function _openDispute(uint256 id, address buyer) internal track(id, keccak256("openDispute")) {
        vm.prank(buyer);
        escrow.openDispute(id, bytes32(seedHash(id)));
    }

    function release(uint256 seed) external {
        (bool found, uint256 id, IDealEscrowTypes.Deal memory d) = _find(seed, Want.Releasable);
        if (!found) return;
        _release(id, d.buyer);
    }

    function _release(uint256 id, address buyer) internal track(id, keccak256("release")) {
        vm.prank(buyer);
        escrow.release(id);
    }

    function sellerRefund(uint256 seed) external {
        (bool found, uint256 id, IDealEscrowTypes.Deal memory d) = _find(seed, Want.Releasable);
        if (!found) return;
        refundReason[id] = 1;
        _sellerRefund(id, d.seller);
    }

    function _sellerRefund(uint256 id, address seller) internal track(id, keccak256("sellerRefund")) {
        vm.prank(seller);
        escrow.refund(id);
    }

    function plugRule(uint256 seed, bool forBuyer) external {
        (bool found, uint256 id, IDealEscrowTypes.Deal memory d) = _find(seed, Want.Rulable);
        if (!found) return;
        if (forBuyer) refundReason[id] = 2;
        _plugRule(id, d.plug, forBuyer);
    }

    function _plugRule(uint256 id, address plug, bool forBuyer) internal track(id, keccak256("plugRule")) {
        vm.prank(plug);
        if (forBuyer) escrow.plugRefund(id, bytes32(0));
        else escrow.plugReject(id, bytes32(0));
    }

    function finalize(uint256 seed) external {
        (bool found, uint256 id,) = _find(seed, Want.Expired);
        if (!found) return;
        refundReason[id] = 3;
        _finalize(id);
    }

    function _finalize(uint256 id) internal track(id, keccak256("finalize")) {
        escrow.finalizeExpiredDispute(id);
    }

    function withdraw(uint256 seed) external {
        (bool found, uint256 id,) = _find(seed, Want.Withdrawable);
        if (!found) return;
        _withdraw(id);
    }

    function _withdraw(uint256 id) internal track(id, keccak256("withdraw")) {
        escrow.withdraw(id);
    }

    function retry(uint256 seed) external {
        (bool found, uint256 id,) = _find(seed, Want.Retryable);
        if (!found) return;
        _retry(id);
    }

    function _retry(uint256 id) internal track(id, keccak256("retry")) {
        escrow.retryPayout(id);
    }

    function toggleBlock(uint256 actorSeed) external {
        address a = actors[actorSeed % actors.length];
        if (!usdc.blocked(a) && actorSeed % 3 != 0) return;
        usdc.setBlocked(a, !usdc.blocked(a));
        _calls[keccak256("toggleBlock")]++;
    }

    function togglePause(uint8 seed) external {
        bool wasPaused = escrow.paused();
        if (!wasPaused && seed % 4 != 0) return;
        vm.prank(owner);
        if (wasPaused) escrow.unpause();
        else escrow.pause();
        _calls[keccak256("togglePause")]++;
    }

    function setLevel(uint256 plugSeed, uint8 level) external {
        address target = actors[plugSeed % 3];
        uint8 newLevel = uint8(bound(level, 0, 5));
        vm.prank(owner);
        escrow.setPlugLevel(target, newLevel);
        _calls[keccak256("setLevel")]++;
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 8 days));
        _calls[keccak256("warp")]++;
    }

    function strayDeposit(uint256 amount) external {
        amount = bound(amount, 1, 10e6);
        usdc.mint(address(escrow), amount);
        totalMinted += amount;
        _calls[keccak256("strayDeposit")]++;
    }

    function sweep() external {
        if (usdc.balanceOf(address(escrow)) <= escrow.totalHeld()) return;
        if (usdc.blocked(owner)) return;
        uint256 before = usdc.balanceOf(owner);
        vm.prank(owner);
        escrow.sweepExcess(owner);
        // swept USDC leaves the actor set; track it so conservation still balances
        totalSwept += usdc.balanceOf(owner) - before;
        _calls[keccak256("sweep")]++;
    }

    uint256 public totalSwept;

    function seedHash(uint256 id) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode("evidence", id)));
    }

    function _indexOf(address a) internal view returns (uint256) {
        for (uint256 i; i < actors.length; ++i) {
            if (actors[i] == a) return i;
        }
        revert("unknown actor");
    }
}
