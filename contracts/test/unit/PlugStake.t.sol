// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Test} from "forge-std/Test.sol";

import {PlugStake} from "../../src/PlugStake.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

contract PlugStakeTest is Test {
    PlugStake internal stake;
    MockUSDC internal usdc;

    address internal council;
    address internal plug;
    address internal plug2;
    address internal victim;
    address internal stranger;

    uint256 internal constant AMOUNT = 100e6; // 100 USDC

    function setUp() public {
        vm.warp(1_790_000_000);
        council = makeAddr("council");
        plug    = makeAddr("plug");
        plug2   = makeAddr("plug2");
        victim  = makeAddr("victim");
        stranger = makeAddr("stranger");

        usdc  = new MockUSDC();
        stake = new PlugStake(IERC20(address(usdc)), council);

        // Fund the test plugs.
        usdc.mint(plug,  10_000e6);
        usdc.mint(plug2, 10_000e6);
        vm.prank(plug);
        usdc.approve(address(stake), type(uint256).max);
        vm.prank(plug2);
        usdc.approve(address(stake), type(uint256).max);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _stake(address who, uint256 amount) internal {
        vm.prank(who);
        stake.stake(amount);
    }

    function _requestWithdraw(address who) internal {
        vm.prank(who);
        stake.requestWithdraw();
    }

    // ── constructor ──────────────────────────────────────────────────────────

    function test_constructor_setsCouncil() public view {
        assertEq(stake.council(), council);
    }

    function test_constructor_rejectsZeroUsdc() public {
        vm.expectRevert(PlugStake.ZeroAddress.selector);
        new PlugStake(IERC20(address(0)), council);
    }

    function test_constructor_rejectsZeroCouncil() public {
        vm.expectRevert(PlugStake.ZeroAddress.selector);
        new PlugStake(IERC20(address(usdc)), address(0));
    }

    // ── stake ─────────────────────────────────────────────────────────────────

    function test_stake_transfersUsdcAndRecordsBalance() public {
        uint256 before = usdc.balanceOf(plug);
        _stake(plug, AMOUNT);
        assertEq(stake.stakeOf(plug), AMOUNT);
        assertEq(usdc.balanceOf(address(stake)), AMOUNT);
        assertEq(usdc.balanceOf(plug), before - AMOUNT);
    }

    function test_stake_emitsStaked() public {
        vm.expectEmit(true, false, false, true);
        emit PlugStake.Staked(plug, AMOUNT);
        _stake(plug, AMOUNT);
    }

    function test_stake_rejectsZeroAmount() public {
        vm.prank(plug);
        vm.expectRevert(PlugStake.AmountZero.selector);
        stake.stake(0);
    }

    function test_stake_rejectsIfAlreadyStaked() public {
        _stake(plug, AMOUNT);
        vm.prank(plug);
        vm.expectRevert(PlugStake.AlreadyStaked.selector);
        stake.stake(AMOUNT);
    }

    function test_stake_allowsRestakeAfterFullWithdrawal() public {
        _stake(plug, AMOUNT);
        _requestWithdraw(plug);
        vm.warp(block.timestamp + stake.WITHDRAWAL_DELAY());
        vm.prank(plug);
        stake.completeWithdraw();
        assertEq(stake.stakeOf(plug), 0);
        // Re-stake should succeed.
        _stake(plug, AMOUNT / 2);
        assertEq(stake.stakeOf(plug), AMOUNT / 2);
    }

    // ── addStake ──────────────────────────────────────────────────────────────

    function test_addStake_increasesBalance() public {
        _stake(plug, AMOUNT);
        vm.prank(plug);
        stake.addStake(AMOUNT);
        assertEq(stake.stakeOf(plug), AMOUNT * 2);
    }

    function test_addStake_rejectsWithoutExistingStake() public {
        vm.prank(plug);
        vm.expectRevert(PlugStake.NoStake.selector);
        stake.addStake(AMOUNT);
    }

    function test_addStake_rejectsZeroAmount() public {
        _stake(plug, AMOUNT);
        vm.prank(plug);
        vm.expectRevert(PlugStake.AmountZero.selector);
        stake.addStake(0);
    }

    function test_addStake_updatesWithdrawRequestAmount() public {
        _stake(plug, AMOUNT);
        _requestWithdraw(plug);
        vm.prank(plug);
        stake.addStake(AMOUNT);
        (uint256 reqAmt,) = stake.withdrawRequest(plug);
        assertEq(reqAmt, AMOUNT * 2);
    }

    // ── requestWithdraw ───────────────────────────────────────────────────────

    function test_requestWithdraw_setsUnlockTime() public {
        _stake(plug, AMOUNT);
        uint64 expectedUnlock = uint64(block.timestamp + stake.WITHDRAWAL_DELAY());
        _requestWithdraw(plug);
        (, uint64 unlocksAt) = stake.withdrawRequest(plug);
        assertEq(unlocksAt, expectedUnlock);
    }

    function test_requestWithdraw_rejectsWithNoStake() public {
        vm.prank(plug);
        vm.expectRevert(PlugStake.NoStake.selector);
        stake.requestWithdraw();
    }

    function test_requestWithdraw_rejectsDoubleRequest() public {
        _stake(plug, AMOUNT);
        _requestWithdraw(plug);
        vm.prank(plug);
        vm.expectRevert(PlugStake.WithdrawAlreadyRequested.selector);
        stake.requestWithdraw();
    }

    // ── completeWithdraw ──────────────────────────────────────────────────────

    function test_completeWithdraw_rejectsBeforeDelay() public {
        _stake(plug, AMOUNT);
        _requestWithdraw(plug);
        (, uint64 unlocksAt) = stake.withdrawRequest(plug);
        // One second before the unlock.
        vm.warp(unlocksAt - 1);
        vm.prank(plug);
        vm.expectRevert(abi.encodeWithSelector(PlugStake.WithdrawNotReady.selector, unlocksAt));
        stake.completeWithdraw();
    }

    function test_completeWithdraw_succeedsAtExactUnlockTime() public {
        _stake(plug, AMOUNT);
        _requestWithdraw(plug);
        (, uint64 unlocksAt) = stake.withdrawRequest(plug);
        vm.warp(unlocksAt);
        uint256 before = usdc.balanceOf(plug);
        vm.prank(plug);
        stake.completeWithdraw();
        assertEq(usdc.balanceOf(plug), before + AMOUNT);
        assertEq(stake.stakeOf(plug), 0);
    }

    function test_completeWithdraw_clearsWithdrawRequest() public {
        _stake(plug, AMOUNT);
        _requestWithdraw(plug);
        (, uint64 unlocksAt) = stake.withdrawRequest(plug);
        vm.warp(unlocksAt);
        vm.prank(plug);
        stake.completeWithdraw();
        (uint256 reqAmt, uint64 reqUnlock) = stake.withdrawRequest(plug);
        assertEq(reqAmt, 0);
        assertEq(reqUnlock, 0);
    }

    function test_completeWithdraw_rejectsWithNoRequest() public {
        _stake(plug, AMOUNT);
        vm.prank(plug);
        vm.expectRevert(PlugStake.NoWithdrawRequest.selector);
        stake.completeWithdraw();
    }

    function test_completeWithdraw_emitsWithdrawCompleted() public {
        _stake(plug, AMOUNT);
        _requestWithdraw(plug);
        (, uint64 unlocksAt) = stake.withdrawRequest(plug);
        vm.warp(unlocksAt);
        vm.expectEmit(true, false, false, true);
        emit PlugStake.WithdrawCompleted(plug, AMOUNT);
        vm.prank(plug);
        stake.completeWithdraw();
    }

    // ── slash ─────────────────────────────────────────────────────────────────

    function test_slash_transfersUsdcToVictim() public {
        _stake(plug, AMOUNT);
        uint256 before = usdc.balanceOf(victim);
        vm.prank(council);
        stake.slash(plug, AMOUNT / 2, victim, keccak256("dealId"), keccak256("reason"));
        assertEq(usdc.balanceOf(victim), before + AMOUNT / 2);
        assertEq(stake.stakeOf(plug), AMOUNT / 2);
    }

    function test_slash_capsAtFullStakeWhenAmountExceeds() public {
        _stake(plug, AMOUNT);
        uint256 before = usdc.balanceOf(victim);
        vm.prank(council);
        // Request slash of 2× the stake — should only take what's there.
        stake.slash(plug, AMOUNT * 2, victim, keccak256("d"), keccak256("r"));
        assertEq(usdc.balanceOf(victim), before + AMOUNT);
        assertEq(stake.stakeOf(plug), 0);
    }

    function test_slash_cancelsWithdrawRequestBeforeSlashing() public {
        _stake(plug, AMOUNT);
        _requestWithdraw(plug);
        vm.prank(council);
        stake.slash(plug, AMOUNT, victim, keccak256("d"), keccak256("r"));
        (uint256 reqAmt, uint64 reqUnlock) = stake.withdrawRequest(plug);
        assertEq(reqAmt, 0);
        assertEq(reqUnlock, 0);
    }

    function test_slash_emitsWithdrawCancelledWhenRequestExists() public {
        _stake(plug, AMOUNT);
        _requestWithdraw(plug);
        vm.expectEmit(true, false, false, false);
        emit PlugStake.WithdrawCancelled(plug);
        vm.prank(council);
        stake.slash(plug, AMOUNT, victim, keccak256("d"), keccak256("r"));
    }

    function test_slash_rejectsFromNonCouncil() public {
        _stake(plug, AMOUNT);
        vm.prank(stranger);
        vm.expectRevert(PlugStake.NotCouncil.selector);
        stake.slash(plug, AMOUNT, victim, keccak256("d"), keccak256("r"));
    }

    function test_slash_rejectsZeroVictim() public {
        _stake(plug, AMOUNT);
        vm.prank(council);
        vm.expectRevert(PlugStake.ZeroAddress.selector);
        stake.slash(plug, AMOUNT, address(0), keccak256("d"), keccak256("r"));
    }

    function test_slash_emitsSlashedEvent() public {
        _stake(plug, AMOUNT);
        bytes32 dealId = keccak256("deal");
        bytes32 reason = keccak256("reason");
        vm.expectEmit(true, true, false, true);
        emit PlugStake.Slashed(plug, victim, AMOUNT, dealId, reason);
        vm.prank(council);
        stake.slash(plug, AMOUNT, victim, dealId, reason);
    }

    function test_slash_noopWhenStakeIsZero() public {
        // No prior stake — slash of 0 amount should emit Slashed with amount=0.
        uint256 before = usdc.balanceOf(victim);
        vm.prank(council);
        stake.slash(plug, AMOUNT, victim, keccak256("d"), keccak256("r"));
        assertEq(usdc.balanceOf(victim), before);
    }

    // ── two-step council transfer ─────────────────────────────────────────────

    function test_proposeNewCouncil_setsProposed() public {
        address newCouncil = makeAddr("newCouncil");
        vm.prank(council);
        stake.proposeNewCouncil(newCouncil);
        assertEq(stake.proposedCouncil(), newCouncil);
        // Current council is unchanged until accepted.
        assertEq(stake.council(), council);
    }

    function test_proposeNewCouncil_rejectsFromNonCouncil() public {
        vm.prank(stranger);
        vm.expectRevert(PlugStake.NotCouncil.selector);
        stake.proposeNewCouncil(makeAddr("x"));
    }

    function test_proposeNewCouncil_rejectsZeroAddress() public {
        vm.prank(council);
        vm.expectRevert(PlugStake.ZeroAddress.selector);
        stake.proposeNewCouncil(address(0));
    }

    function test_acceptCouncil_transfersRole() public {
        address newCouncil = makeAddr("newCouncil");
        vm.prank(council);
        stake.proposeNewCouncil(newCouncil);

        vm.expectEmit(true, true, false, false);
        emit PlugStake.CouncilUpdated(council, newCouncil);
        vm.prank(newCouncil);
        stake.acceptCouncil();

        assertEq(stake.council(), newCouncil);
        assertEq(stake.proposedCouncil(), address(0));
    }

    function test_acceptCouncil_rejectsFromWrongAddress() public {
        address newCouncil = makeAddr("newCouncil");
        vm.prank(council);
        stake.proposeNewCouncil(newCouncil);

        vm.prank(stranger);
        vm.expectRevert(PlugStake.NotProposedCouncil.selector);
        stake.acceptCouncil();
    }

    function test_acceptCouncil_rejectsWhenNoneProposed() public {
        vm.prank(stranger);
        vm.expectRevert(PlugStake.NotProposedCouncil.selector);
        stake.acceptCouncil();
    }

    function test_newCouncilCanSlash() public {
        address newCouncil = makeAddr("newCouncil");
        vm.prank(council);
        stake.proposeNewCouncil(newCouncil);
        vm.prank(newCouncil);
        stake.acceptCouncil();

        _stake(plug, AMOUNT);
        vm.prank(newCouncil);
        stake.slash(plug, AMOUNT, victim, keccak256("d"), keccak256("r"));
        assertEq(stake.stakeOf(plug), 0);
    }

    function test_oldCouncilCannotSlashAfterTransfer() public {
        address newCouncil = makeAddr("newCouncil");
        vm.prank(council);
        stake.proposeNewCouncil(newCouncil);
        vm.prank(newCouncil);
        stake.acceptCouncil();

        _stake(plug, AMOUNT);
        vm.prank(council);
        vm.expectRevert(PlugStake.NotCouncil.selector);
        stake.slash(plug, AMOUNT, victim, keccak256("d"), keccak256("r"));
    }

    // ── withdrawRequest view ──────────────────────────────────────────────────

    function test_withdrawRequest_returnsZerosForNoRequest() public view {
        (uint256 amt, uint64 t) = stake.withdrawRequest(plug);
        assertEq(amt, 0);
        assertEq(t, 0);
    }

    // ── fuzz ─────────────────────────────────────────────────────────────────

    function testFuzz_stakeAndRetrieve(uint96 amount) public {
        vm.assume(amount > 0);
        usdc.mint(plug2, amount);
        vm.prank(plug2);
        usdc.approve(address(stake), amount);
        vm.prank(plug2);
        stake.stake(amount);
        assertEq(stake.stakeOf(plug2), amount);
    }

    function testFuzz_slashNeverTransfersMoreThanStake(uint96 stakeAmt, uint96 slashAmt) public {
        vm.assume(stakeAmt > 0);
        usdc.mint(plug2, stakeAmt);
        vm.prank(plug2);
        usdc.approve(address(stake), stakeAmt);
        vm.prank(plug2);
        stake.stake(stakeAmt);

        uint256 victimBefore = usdc.balanceOf(victim);
        vm.prank(council);
        stake.slash(plug2, slashAmt, victim, keccak256("d"), keccak256("r"));

        uint256 transferred = usdc.balanceOf(victim) - victimBefore;
        assertLe(transferred, stakeAmt);
        assertEq(stake.stakeOf(plug2) + transferred, stakeAmt);
    }
}
