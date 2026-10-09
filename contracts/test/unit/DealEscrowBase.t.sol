// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Test} from "forge-std/Test.sol";

import {DealEscrow} from "../../src/DealEscrow.sol";
import {IDealEscrowTypes} from "../../src/interfaces/IDealEscrowTypes.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @dev Shared setup: a listed Level 5 plug, a funded buyer, and helpers that sign terms the way the app does.
abstract contract DealEscrowBase is Test {
    uint256 internal constant ARC_MAINNET = 5042;
    uint256 internal constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    DealEscrow internal escrow;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal seller;
    uint256 internal sellerKey;
    address internal plug;
    uint256 internal plugKey;
    address internal buyer;
    uint256 internal buyerKey;
    address internal stranger = makeAddr("stranger");

    uint256 internal nextOrder;

    function setUp() public virtual {
        vm.chainId(ARC_MAINNET);
        vm.warp(1_790_000_000);
        (seller, sellerKey) = makeAddrAndKey("seller");
        (plug, plugKey) = makeAddrAndKey("plug");
        (buyer, buyerKey) = makeAddrAndKey("buyer");

        usdc = new MockUSDC();
        escrow = new DealEscrow(IERC20(address(usdc)), owner);
        vm.prank(owner);
        escrow.setPlugLevel(plug, 5);

        usdc.mint(buyer, 10_000e6);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _terms(uint256 price, uint256 fee, uint32 window) internal returns (IDealEscrowTypes.Terms memory t) {
        t = IDealEscrowTypes.Terms({
            seller: seller,
            plug: plug,
            orderId: keccak256(abi.encode("order", nextOrder++)),
            price: price,
            plugFee: fee,
            windowSeconds: window,
            expiry: uint64(block.timestamp + 7 days),
            metadataHash: keccak256("job: logo design")
        });
    }

    function _defaultTerms() internal returns (IDealEscrowTypes.Terms memory) {
        return _terms(5e6, 150_000, 3 days);
    }

    function _sig(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _sellerSig(IDealEscrowTypes.Terms memory t) internal view returns (bytes memory) {
        return _sig(sellerKey, escrow.termsDigest(t));
    }

    function _plugSig(IDealEscrowTypes.Terms memory t) internal view returns (bytes memory) {
        return _sig(plugKey, escrow.acceptDigest(escrow.termsHash(t), t.plug));
    }

    function _pay(IDealEscrowTypes.Terms memory t) internal returns (uint256 id) {
        bytes memory s = _sellerSig(t);
        bytes memory p = _plugSig(t);
        vm.prank(buyer);
        id = escrow.pay(t, s, p, buyer);
    }

    function _payDefault() internal returns (uint256 id, IDealEscrowTypes.Terms memory t) {
        t = _defaultTerms();
        id = _pay(t);
    }

    function _escrowed(IDealEscrowTypes.Terms memory t) internal pure returns (uint256) {
        return t.price + t.plugFee / 2;
    }

    function _status(uint256 id) internal view returns (IDealEscrowTypes.Status) {
        return escrow.getDeal(id).status;
    }

    function _dispute(uint256 id) internal {
        vm.prank(buyer);
        escrow.openDispute(id, keccak256("evidence"));
    }
}
