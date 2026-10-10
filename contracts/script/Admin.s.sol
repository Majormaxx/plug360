// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

import {DealEscrow} from "../src/DealEscrow.sol";

/// @notice Owner operations. When the owner is an EOA, broadcast with the owner key. When the owner is a
///         Safe, run without --broadcast and paste the printed calldata into the Safe transaction builder.
///         Env: ESCROW. Examples:
///           forge script script/Admin.s.sol --sig "setPlugLevel(address,uint8)" 0xPLUG 1 --rpc-url arc_testnet
///           forge script script/Admin.s.sol --sig "pause()" --rpc-url arc_mainnet
contract Admin is Script {
    function _escrow() internal view returns (DealEscrow) {
        return DealEscrow(vm.envAddress("ESCROW"));
    }

    function setPlugLevel(address plug, uint8 level) external {
        DealEscrow e = _escrow();
        require(level <= e.MAX_LEVEL(), "level out of range");
        _print("setPlugLevel", abi.encodeCall(e.setPlugLevel, (plug, level)));
        vm.broadcast();
        e.setPlugLevel(plug, level);
        require(e.plugLevel(plug) == level, "level not set");
        console.log("plug level", plug, level);
    }

    function pause() external {
        DealEscrow e = _escrow();
        _print("pause", abi.encodeCall(e.pause, ()));
        vm.broadcast();
        e.pause();
        require(e.paused(), "not paused");
    }

    function unpause() external {
        DealEscrow e = _escrow();
        _print("unpause", abi.encodeCall(e.unpause, ()));
        vm.broadcast();
        e.unpause();
        require(!e.paused(), "still paused");
    }

    function transferOwnership(address next) external {
        DealEscrow e = _escrow();
        _print("transferOwnership", abi.encodeCall(e.transferOwnership, (next)));
        vm.broadcast();
        e.transferOwnership(next);
        require(e.pendingOwner() == next, "pending owner not set");
    }

    function sweepExcess(address to) external {
        DealEscrow e = _escrow();
        _print("sweepExcess", abi.encodeCall(e.sweepExcess, (to)));
        vm.broadcast();
        e.sweepExcess(to);
    }

    function _print(string memory action, bytes memory data) internal view {
        console.log("action", action);
        console.log("to", address(_escrow()));
        console.logBytes(data);
    }
}
