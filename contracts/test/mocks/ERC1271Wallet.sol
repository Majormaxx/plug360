// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev Minimal smart wallet: a signature is valid when its single owner key signed the digest.
contract ERC1271Wallet is IERC1271 {
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        return err == ECDSA.RecoverError.NoError && recovered == owner ? this.isValidSignature.selector : bytes4(0);
    }

    function execute(address target, bytes calldata data) external returns (bytes memory) {
        require(msg.sender == owner, "not owner");
        (bool ok, bytes memory ret) = target.call(data);
        require(ok, "call failed");
        return ret;
    }
}
