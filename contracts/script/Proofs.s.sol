// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Script, console} from "forge-std/Script.sol";

import {DealEscrow} from "../src/DealEscrow.sol";
import {IDealEscrowTypes} from "../src/interfaces/IDealEscrowTypes.sol";

/// @notice Runs every money path once with real transactions and writes deployments/<chainId>-proofs.json:
///         canary (1 USDC, seller refund), P1 seller refund, P2 plug rules for the buyer, P3 plug rejects and
///         the seller withdraws, P4 signed early release relayed by a third party, P5 zero-length window.
///         Env: ESCROW, SELLER_KEY, PLUG_KEY, BUYER_KEY, optional RELAYER_KEY (defaults to the seller),
///         PROOF_SALT, PROOF_PRICE (default 1 USDC) and PROOF_FEE (default 2% of the price, rounded to an even
///         amount). The plug must already be listed at level 1 or higher.
///         Capital: the seller sends what each paid-out deal brought in back to the buyer, so the buyer only ever
///         needs one deal's worth (price + fee / 2) plus gas. With the defaults that is about 1.05 USDC.
contract Proofs is Script {
    DealEscrow internal escrow;
    IERC20 internal usdc;
    uint256 internal sellerKey;
    uint256 internal plugKey;
    uint256 internal buyerKey;
    uint256 internal relayerKey;
    address internal seller;
    address internal plug;
    address internal buyer;
    bytes32 internal salt;
    uint256 internal price;
    uint256 internal fee;

    string internal constant OUT = "proofs";

    function run() external {
        escrow = DealEscrow(vm.envAddress("ESCROW"));
        usdc = escrow.USDC();
        sellerKey = vm.envUint("SELLER_KEY");
        plugKey = vm.envUint("PLUG_KEY");
        buyerKey = vm.envUint("BUYER_KEY");
        relayerKey = vm.envOr("RELAYER_KEY", sellerKey);
        seller = vm.addr(sellerKey);
        plug = vm.addr(plugKey);
        buyer = vm.addr(buyerKey);
        salt = bytes32(vm.envOr("PROOF_SALT", block.timestamp));

        price = vm.envOr("PROOF_PRICE", uint256(1e6));
        fee = vm.envOr("PROOF_FEE", (price * 200 / 10_000) & ~uint256(1));
        uint256 perDeal = price + fee / 2;

        require(escrow.plugLevel(plug) >= 1, "plug not listed");
        require(price <= escrow.levelCap(escrow.plugLevel(plug)), "price over the plug's cap");
        require(!escrow.paused(), "escrow paused");
        require(usdc.balanceOf(buyer) >= perDeal, "buyer needs one deal's worth of USDC");

        // canary (1 USDC, no fee) plus five paths; allowance is consumed as deals are funded
        vm.broadcast(buyerKey);
        usdc.approve(address(escrow), 1e6 + 5 * perDeal);

        uint256 canary = _pay("canary", 1e6, 0, 1 days);
        vm.broadcast(sellerKey);
        escrow.refund(canary);
        _expect(canary, IDealEscrowTypes.Status.Refunded);

        uint256 p1 = _pay("P1", price, fee, 1 days);
        vm.broadcast(sellerKey);
        escrow.refund(p1);
        _expect(p1, IDealEscrowTypes.Status.Refunded);

        uint256 p2 = _pay("P2", price, fee, 1 days);
        vm.broadcast(buyerKey);
        escrow.openDispute(p2, keccak256("proof: item not delivered"));
        vm.broadcast(plugKey);
        escrow.plugRefund(p2, keccak256("proof: refund"));
        _expect(p2, IDealEscrowTypes.Status.Refunded);

        uint256 p3 = _pay("P3", price, fee, 1 days);
        vm.broadcast(buyerKey);
        escrow.openDispute(p3, keccak256("proof: disputed"));
        vm.broadcast(plugKey);
        escrow.plugReject(p3, keccak256("proof: work delivered"));
        vm.broadcast(sellerKey);
        escrow.withdraw(p3);
        _expect(p3, IDealEscrowTypes.Status.Settled);
        _recycle();

        uint256 p4 = _pay("P4", price, fee, 1 days);
        IDealEscrowTypes.Deal memory d4 = escrow.getDeal(p4);
        uint256 deadline = d4.releaseAt;
        bytes32 digest =
            escrow.releaseDigest(p4, buyer, uint256(d4.price) + d4.plugFee / 2, escrow.releaseNonce(buyer), deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerKey, digest);
        vm.broadcast(relayerKey);
        escrow.releaseWithSig(p4, deadline, abi.encodePacked(r, s, v));
        vm.broadcast(sellerKey);
        escrow.withdraw(p4);
        _expect(p4, IDealEscrowTypes.Status.Settled);
        _recycle();

        uint256 p5 = _pay("P5", price, fee, 0);
        vm.broadcast(buyerKey);
        escrow.withdraw(p5);
        _expect(p5, IDealEscrowTypes.Status.Settled);
        _recycle();

        string memory json = vm.serializeAddress(OUT, "escrow", address(escrow));
        json = vm.serializeUint(OUT, "chainId", block.chainid);
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), "-proofs.json"));
        console.log("all proof paths completed; totalHeld", escrow.totalHeld());
    }

    function _pay(string memory label, uint256 price, uint256 fee, uint32 window) internal returns (uint256 id) {
        IDealEscrowTypes.Terms memory t = IDealEscrowTypes.Terms({
            seller: seller,
            plug: plug,
            orderId: keccak256(abi.encode(salt, label)),
            price: price,
            plugFee: fee,
            windowSeconds: window,
            expiry: uint64(block.timestamp + 1 days),
            metadataHash: keccak256(abi.encode("plug360 proof", label))
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sellerKey, escrow.termsDigest(t));
        bytes memory sellerSig = abi.encodePacked(r, s, v);
        (v, r, s) = vm.sign(plugKey, escrow.acceptDigest(escrow.termsHash(t), plug));
        bytes memory plugSig = abi.encodePacked(r, s, v);
        vm.broadcast(buyerKey);
        id = escrow.pay(t, sellerSig, plugSig, buyer);
        vm.serializeUint(OUT, label, id);
        console.log(label, "deal", id);
    }

    /// @dev Returns the seller's payout to the buyer so the next path can reuse the same capital.
    function _recycle() internal {
        vm.broadcast(sellerKey);
        usdc.transfer(buyer, price - (fee - fee / 2));
    }

    function _expect(uint256 id, IDealEscrowTypes.Status want) internal view {
        IDealEscrowTypes.Deal memory d = escrow.getDeal(id);
        require(d.status == want, "unexpected status");
        require(!d.payoutPending, "payout parked");
    }
}
