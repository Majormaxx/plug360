// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev On every transfer it tries to call back into the escrow with `payload`.
contract ReentrantToken is ERC20 {
    address public target;
    bytes public payload;
    bool public reentered;
    bool public reentrySucceeded;

    constructor() ERC20("Hostile", "HOST") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (target != address(0) && !reentered) {
            reentered = true;
            (bool ok,) = target.call(payload);
            reentrySucceeded = ok;
        }
    }
}

/// @dev Burns 1% of every transfer, so the escrow receives less than it asked for.
contract FeeOnTransferToken is ERC20 {
    constructor() ERC20("Taxed", "TAX") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 tax = value / 100;
            super._update(from, address(0), tax);
            value -= tax;
        }
        super._update(from, to, value);
    }
}
