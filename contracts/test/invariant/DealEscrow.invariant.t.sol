// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";

import {DealEscrow} from "../../src/DealEscrow.sol";
import {IDealEscrowTypes} from "../../src/interfaces/IDealEscrowTypes.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {DealEscrowHandler} from "./DealEscrowHandler.sol";

/// @notice Random sequences of deals, disputes, rulings, releases, refunds, withdrawals, retries, pauses,
///         blocklist toggles, level changes and time jumps. Every rule below must hold after every call.
///         fail_on_revert: the handler only makes calls that must succeed, so a valid exit that reverts
///         (while paused, or with a blocklisted party) fails the campaign. That is how rule 10 is enforced.
/// forge-config: default.invariant.fail-on-revert = true
/// forge-config: ci.invariant.fail-on-revert = true
contract DealEscrowInvariantTest is StdInvariant, Test {
    DealEscrow internal escrow;
    MockUSDC internal usdc;
    DealEscrowHandler internal handler;
    address internal owner = makeAddr("owner");

    function setUp() public {
        vm.chainId(5042);
        vm.warp(1_790_000_000);
        usdc = new MockUSDC();
        escrow = new DealEscrow(IERC20(address(usdc)), owner);
        handler = new DealEscrowHandler(escrow, usdc, owner);
        targetContract(address(handler));
    }

    /// Rule 1: the escrow always holds at least what it owes.
    function invariant_balanceCoversTotalHeld() public view {
        assertGe(usdc.balanceOf(address(escrow)), escrow.totalHeld());
    }

    /// Rule 2: totalHeld equals the escrow of unfinished deals plus parked legs, exactly.
    function invariant_totalHeldIsExact() public view {
        uint256 expected;
        for (uint256 i; i < handler.dealCount(); ++i) {
            uint256 id = handler.dealIds(i);
            IDealEscrowTypes.Deal memory d = escrow.getDeal(id);
            if (_open(d.status)) expected += uint256(d.price) + d.plugFee / 2;
            (uint256 r, uint256 s, uint256 p) = escrow.pendingPayouts(id);
            expected += r + s + p;
        }
        assertEq(escrow.totalHeld(), expected);
    }

    /// Rules 3 and 4: a deal never pays out more than its escrow; a final deal accounts for all of it.
    function invariant_legsSumToEscrow() public view {
        for (uint256 i; i < handler.dealCount(); ++i) {
            uint256 id = handler.dealIds(i);
            IDealEscrowTypes.Deal memory d = escrow.getDeal(id);
            (uint256 r, uint256 s, uint256 p) = escrow.pendingPayouts(id);
            uint256 accounted = handler.outflow(id) + r + s + p;
            if (_open(d.status)) assertEq(accounted, 0, "money left an unfinished deal");
            else assertEq(accounted, uint256(d.price) + d.plugFee / 2, "final deal not fully accounted");
        }
    }

    /// Rule 3: USDC only moves between deal parties and the escrow (plus swept stray deposits).
    function invariant_conservation() public view {
        uint256 sum = usdc.balanceOf(address(escrow));
        for (uint256 i; i < handler.actorCount(); ++i) {
            sum += usdc.balanceOf(handler.actors(i));
        }
        assertEq(sum + handler.totalSwept(), handler.totalMinted());
    }

    /// Rule 5: statuses follow the state machine and final statuses never change.
    function invariant_stateMachine() public view {
        assertFalse(handler.illegalTransition(), "illegal transition");
        assertFalse(handler.finalStatusChanged(), "final status changed");
    }

    /// Rule 6: parties, amounts and timing are write-once.
    function invariant_writeOnceFields() public view {
        for (uint256 i; i < handler.dealCount(); ++i) {
            uint256 id = handler.dealIds(i);
            IDealEscrowTypes.Deal memory d = escrow.getDeal(id);
            IDealEscrowTypes.Deal memory s = handler.snapshot(id);
            assertEq(d.buyer, s.buyer);
            assertEq(d.seller, s.seller);
            assertEq(d.plug, s.plug);
            assertEq(d.refundTo, s.refundTo);
            assertEq(d.price, s.price);
            assertEq(d.plugFee, s.plugFee);
            assertEq(d.paidAt, s.paidAt);
            assertEq(d.releaseAt, s.releaseAt);
            assertEq(d.orderId, s.orderId);
        }
    }

    /// Rule 7: the plug earns the full fee on settlement, half on a ruling for the buyer, otherwise nothing.
    function invariant_plugPaidOnlyWhenEarned() public view {
        for (uint256 i; i < handler.dealCount(); ++i) {
            uint256 id = handler.dealIds(i);
            IDealEscrowTypes.Deal memory d = escrow.getDeal(id);
            (,, uint256 parkedPlug) = escrow.pendingPayouts(id);
            uint256 earned = handler.plugReceived(id) + parkedPlug;
            if (d.status == IDealEscrowTypes.Status.Settled) {
                assertEq(earned, d.plugFee);
            } else if (d.status == IDealEscrowTypes.Status.Refunded && handler.refundReason(id) == 2) {
                assertEq(earned, d.plugFee / 2);
            } else {
                assertEq(earned, 0);
            }
        }
    }

    /// Rules 8 and 9: three distinct parties, a valid refund address, and price within the cap at funding.
    function invariant_partiesAndCaps() public view {
        for (uint256 i; i < handler.dealCount(); ++i) {
            uint256 id = handler.dealIds(i);
            IDealEscrowTypes.Deal memory d = escrow.getDeal(id);
            assertTrue(d.buyer != d.seller && d.buyer != d.plug && d.seller != d.plug, "parties overlap");
            assertTrue(d.refundTo != d.seller && d.refundTo != d.plug, "bad refund address");
            assertLe(d.price, escrow.levelCap(handler.levelAtFunding(id)), "over level cap");
        }
    }

    /// Held cap: total owed never exceeds 2,500 USDC (parked legs can only come from funded deals).
    function invariant_heldCap() public view {
        assertLe(escrow.totalHeld(), escrow.MAX_TOTAL_HELD());
    }

    /// Campaign coverage: each run appends its action counts to cache/invariant-stats.csv so a handler that
    /// silently skips paths is visible (summarize with script/invariant-stats.sh).
    function afterInvariant() public {
        string[10] memory names = [
            "pay",
            "openDispute",
            "release",
            "sellerRefund",
            "plugRule",
            "finalize",
            "withdraw",
            "retry",
            "togglePause",
            "toggleBlock"
        ];
        string memory row = "";
        for (uint256 i; i < names.length; ++i) {
            row = string.concat(row, i == 0 ? "" : ",", vm.toString(handler.calls(keccak256(bytes(names[i])))));
        }
        vm.writeLine("cache/invariant-stats.csv", row);
    }

    function _open(IDealEscrowTypes.Status s) internal pure returns (bool) {
        return s == IDealEscrowTypes.Status.Held || s == IDealEscrowTypes.Status.Disputed
            || s == IDealEscrowTypes.Status.Released;
    }
}
