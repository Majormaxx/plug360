// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Test} from "forge-std/Test.sol";

/// @dev Calls USDC from a separate contract, the way DealEscrow will.
contract UsdcCaller {
    IERC20 internal constant USDC = IERC20(0x3600000000000000000000000000000000000000);

    function tryTransfer(address to, uint256 amount) external returns (bool caught, bool returned) {
        try USDC.transfer(to, amount) returns (bool ok) {
            return (false, ok);
        } catch {
            return (true, false);
        }
    }
}

/// @notice Pins the Arc behaviors DealEscrow's payout design depends on. Arc-only:
///         FOUNDRY_PROFILE=arc arc-forge test --network arc
contract ArcUsdcBehaviorTest is Test {
    IERC20 internal constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    /// @dev Arc's native-coin control contract; blocklist flag lives at keccak256(abi.encode(account, 2)).
    address internal constant NATIVE_COIN_CONTROL = address(uint160((uint256(0x18) << 152) | 1));

    UsdcCaller internal caller;
    address internal blocked = makeAddr("blocked");
    address internal recipient = makeAddr("recipient");

    function setUp() public {
        caller = new UsdcCaller();
        vm.deal(address(caller), 10 ether); // 10 USDC at 18 native decimals
    }

    function _blocklist(address account) internal {
        vm.store(NATIVE_COIN_CONTROL, keccak256(abi.encode(account, uint256(2))), bytes32(uint256(1)));
    }

    function test_erc20Interface_readsNativeBalanceAtSixDecimals() public view {
        assertEq(USDC.balanceOf(address(caller)), 10e6);
        assertEq(address(caller).balance, 10 ether);
    }

    function test_transfer_toNormalAddressSucceeds() public {
        (bool caught, bool ok) = caller.tryTransfer(recipient, 1e6);
        assertFalse(caught);
        assertTrue(ok);
        assertEq(USDC.balanceOf(recipient), 1e6);
        assertEq(USDC.balanceOf(address(caller)), 9e6);
    }

    /// @dev The design question: a blocked payout leg must fail inside try/catch, not abort the transaction.
    function test_transfer_toBlocklistedAddressIsCatchable() public {
        _blocklist(blocked);
        (bool caught, bool ok) = caller.tryTransfer(blocked, 1e6);
        assertTrue(caught || !ok, "blocked transfer reported success");
        assertEq(USDC.balanceOf(blocked), 0);
        assertEq(USDC.balanceOf(address(caller)), 10e6, "funds left the caller");
    }

    function test_transfer_fromBlocklistedSenderIsCatchable() public {
        _blocklist(address(caller));
        (bool caught, bool ok) = caller.tryTransfer(recipient, 1e6);
        assertTrue(caught || !ok, "blocked sender moved funds");
        assertEq(USDC.balanceOf(recipient), 0);
    }

    function test_transfer_otherLegsStillPayAfterOneIsBlocked() public {
        _blocklist(blocked);
        (bool caughtBlocked,) = caller.tryTransfer(blocked, 1e6);
        (bool caughtOk, bool ok) = caller.tryTransfer(recipient, 2e6);
        assertTrue(caughtBlocked);
        assertFalse(caughtOk);
        assertTrue(ok);
        assertEq(USDC.balanceOf(recipient), 2e6);
        assertEq(USDC.balanceOf(address(caller)), 8e6);
    }
}
