// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {IDealEscrowAdmin} from "./interfaces/IDealEscrowAdmin.sol";

/// @title DealEscrow
/// @notice Holds USDC for deals refereed by a plug. Each deal's money is accounted for on its own,
///         never pooled, and the owner cannot move it.
/// @dev Design modeled on Circle Research's Refund Protocol (Apache-2.0); see NOTICE.
///      The deal lifecycle (IDealEscrow) lands on top of this base.
contract DealEscrow is IDealEscrowAdmin, EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice USDC through its 6-decimal ERC-20 interface. Native (18-decimal) balances are never read.
    IERC20 public immutable USDC;

    uint256 public constant MIN_AMOUNT = 1e6;
    uint256 public constant MAX_TOTAL_HELD = 2_500e6;
    uint32 public constant MAX_WINDOW = 14 days;
    uint32 public constant PLUG_WINDOW = 7 days;
    uint64 public constant MAX_TERMS_LIFETIME = 30 days;
    uint256 public constant MAX_FEE_BPS = 500;
    uint256 public constant MAX_BATCH = 50;
    uint8 public constant MAX_LEVEL = 5;

    bytes32 public constant TERMS_TYPEHASH = keccak256(
        "Terms(address seller,address plug,bytes32 orderId,uint256 price,uint256 plugFee,uint32 windowSeconds,uint64 expiry,bytes32 metadataHash)"
    );
    bytes32 public constant ACCEPT_TYPEHASH = keccak256("Accept(bytes32 termsHash,address plug)");
    bytes32 public constant RELEASE_TYPEHASH =
        keccak256("Release(uint256 dealId,address buyer,uint256 amount,uint256 nonce,uint256 deadline)");

    /// @inheritdoc IDealEscrowAdmin
    mapping(address plug => uint8 level) public plugLevel;

    /// @inheritdoc IDealEscrowAdmin
    mapping(address buyer => uint256 nonce) public releaseNonce;

    /// @inheritdoc IDealEscrowAdmin
    uint256 public totalHeld;

    constructor(IERC20 usdc, address initialOwner) EIP712("DealEscrow", "1") Ownable(initialOwner) {
        if (address(usdc) == address(0)) revert ZeroAddress();
        USDC = usdc;
    }

    // ---------------------------------------------------------------- owner

    /// @inheritdoc IDealEscrowAdmin
    function setPlugLevel(address plug, uint8 level) external onlyOwner {
        if (plug == address(0)) revert ZeroAddress();
        if (level > MAX_LEVEL) revert InvalidLevel();
        plugLevel[plug] = level;
        emit PlugLevelSet(plug, level);
    }

    /// @inheritdoc IDealEscrowAdmin
    function pause() external onlyOwner {
        _pause();
    }

    /// @inheritdoc IDealEscrowAdmin
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @inheritdoc IDealEscrowAdmin
    function sweepExcess(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = USDC.balanceOf(address(this));
        if (balance <= totalHeld) revert NothingToSweep();
        uint256 amount = balance - totalHeld;
        USDC.safeTransfer(to, amount);
        emit ExcessSwept(to, amount);
    }

    /// @notice Disabled: without an owner, plug levels and the pause switch could never change again.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ---------------------------------------------------------------- buyers

    /// @inheritdoc IDealEscrowAdmin
    function cancelNonce() external {
        uint256 nonce = releaseNonce[msg.sender]++;
        emit NonceCancelled(msg.sender, nonce);
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IDealEscrowAdmin
    function levelCap(uint8 level) public pure returns (uint256) {
        if (level == 0) return 0;
        if (level == 1) return 5e6;
        if (level == 2) return 10e6;
        if (level == 3) return 25e6;
        if (level == 4) return 50e6;
        if (level == 5) return 100e6;
        revert InvalidLevel();
    }

    /// @inheritdoc IDealEscrowAdmin
    function dealIdOf(address seller, bytes32 orderId) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(seller, orderId)));
    }

    /// @inheritdoc IDealEscrowAdmin
    function termsHash(Terms calldata terms) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                TERMS_TYPEHASH,
                terms.seller,
                terms.plug,
                terms.orderId,
                terms.price,
                terms.plugFee,
                terms.windowSeconds,
                terms.expiry,
                terms.metadataHash
            )
        );
    }

    /// @inheritdoc IDealEscrowAdmin
    function termsDigest(Terms calldata terms) external view returns (bytes32) {
        return _hashTypedDataV4(termsHash(terms));
    }

    /// @inheritdoc IDealEscrowAdmin
    function acceptDigest(bytes32 termsHash_, address plug) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ACCEPT_TYPEHASH, termsHash_, plug)));
    }

    /// @inheritdoc IDealEscrowAdmin
    function releaseDigest(uint256 dealId, address buyer, uint256 amount, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(RELEASE_TYPEHASH, dealId, buyer, amount, nonce, deadline)));
    }
}
