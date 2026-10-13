// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC1271Wallet} from "./ERC1271Wallet.sol";

/// @dev Counterfactual wallet factory for tests: a wallet's address is known before it is deployed, the way
///      smart-account wallets sign ERC-6492 signatures before their first transaction.
contract SmartWalletFactory {
    function deploy(address owner, bytes32 salt) external returns (address wallet) {
        wallet = address(new ERC1271Wallet{salt: salt}(owner));
    }

    function addressOf(address owner, bytes32 salt) external view returns (address) {
        bytes32 initCode = keccak256(abi.encodePacked(type(ERC1271Wallet).creationCode, abi.encode(owner)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCode)))));
    }
}
