// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Script, console} from "forge-std/Script.sol";

import {DealEscrow} from "../src/DealEscrow.sol";

/// @notice Deploys DealEscrow and writes deployments/<chainId>.json.
///         Env: OWNER (required; a Safe on mainnet), USDC (defaults to Arc's USDC interface).
///         make deploy-testnet / make deploy-mainnet wrap this with the Arc gas floor and Sourcify verification.
contract Deploy is Script {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    uint256 internal constant ARC_MAINNET = 5042;
    uint256 internal constant ARC_TESTNET = 5042002;

    function run() external returns (DealEscrow escrow) {
        address owner = vm.envAddress("OWNER");
        address usdc = vm.envOr("USDC", ARC_USDC);
        require(owner != address(0), "OWNER unset");
        require(block.chainid == ARC_MAINNET || block.chainid == ARC_TESTNET || block.chainid == 31337, "unknown chain");
        if (block.chainid != 31337) {
            require(usdc == ARC_USDC, "USDC must be Arc's interface on Arc");
            require(IERC20(usdc).totalSupply() > 0, "USDC interface not found");
        }

        vm.startBroadcast();
        escrow = new DealEscrow(IERC20(usdc), owner);
        vm.stopBroadcast();

        require(escrow.owner() == owner, "owner mismatch");
        require(address(escrow.USDC()) == usdc, "usdc mismatch");

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "escrow", address(escrow));
        vm.serializeAddress(key, "owner", owner);
        vm.serializeAddress(key, "usdc", usdc);
        vm.serializeUint(key, "deployBlock", block.number);
        string memory json = vm.serializeUint(key, "deployedAt", block.timestamp);
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console.log("DealEscrow", address(escrow));
        console.log("written", path);
    }
}
