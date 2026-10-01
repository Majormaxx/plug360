// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Test} from "forge-std/Test.sol";

import {DealEscrow} from "../../src/DealEscrow.sol";
import {IDealEscrowTypes} from "../../src/interfaces/IDealEscrowTypes.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

contract DealEscrowAdminTest is Test {
    uint256 internal constant ARC_MAINNET = 5042;

    DealEscrow internal escrow;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal stranger = makeAddr("stranger");
    address internal plug = makeAddr("plug");
    address internal sellerAddr = makeAddr("seller");

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new DealEscrow(IERC20(address(usdc)), owner);
    }

    // ------------------------------------------------------------ deployment

    function test_constructor_setsUsdcAndOwner() public view {
        assertEq(address(escrow.USDC()), address(usdc));
        assertEq(escrow.owner(), owner);
        assertEq(escrow.totalHeld(), 0);
        assertFalse(escrow.paused());
    }

    function test_constructor_revertsOnZeroUsdc() public {
        vm.expectRevert(IDealEscrowTypes.ZeroAddress.selector);
        new DealEscrow(IERC20(address(0)), owner);
    }

    function test_constructor_revertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new DealEscrow(IERC20(address(usdc)), address(0));
    }

    function test_limits_matchProductRules() public view {
        assertEq(escrow.MIN_AMOUNT(), 1e6);
        assertEq(escrow.MAX_TOTAL_HELD(), 2_500e6);
        assertEq(escrow.MAX_WINDOW(), 14 days);
        assertEq(escrow.PLUG_WINDOW(), 7 days);
        assertEq(escrow.MAX_TERMS_LIFETIME(), 30 days);
        assertEq(escrow.MAX_FEE_BPS(), 500);
        assertEq(escrow.MAX_BATCH(), 50);
    }

    // ------------------------------------------------------------ plug levels

    function test_levelCap_table() public view {
        assertEq(escrow.levelCap(0), 0);
        assertEq(escrow.levelCap(1), 5e6);
        assertEq(escrow.levelCap(2), 10e6);
        assertEq(escrow.levelCap(3), 25e6);
        assertEq(escrow.levelCap(4), 50e6);
        assertEq(escrow.levelCap(5), 100e6);
    }

    function testFuzz_levelCap_revertsAboveMax(uint8 level) public {
        level = uint8(bound(level, 6, type(uint8).max));
        vm.expectRevert(IDealEscrowTypes.InvalidLevel.selector);
        escrow.levelCap(level);
    }

    function test_levelCap_neverExceedsPerDealCap() public view {
        for (uint8 level; level <= escrow.MAX_LEVEL(); ++level) {
            assertLe(escrow.levelCap(level), 100e6);
        }
    }

    function testFuzz_setPlugLevel_ownerSetsAndEmits(uint8 level) public {
        level = uint8(bound(level, 0, 5));
        vm.expectEmit(true, false, false, true, address(escrow));
        emit IDealEscrowTypes.PlugLevelSet(plug, level);
        vm.prank(owner);
        escrow.setPlugLevel(plug, level);
        assertEq(escrow.plugLevel(plug), level);
    }

    function test_setPlugLevel_zeroDelists() public {
        vm.startPrank(owner);
        escrow.setPlugLevel(plug, 3);
        escrow.setPlugLevel(plug, 0);
        vm.stopPrank();
        assertEq(escrow.plugLevel(plug), 0);
    }

    function test_setPlugLevel_revertsForNonOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        escrow.setPlugLevel(plug, 1);
    }

    function test_setPlugLevel_revertsAboveMax() public {
        vm.expectRevert(IDealEscrowTypes.InvalidLevel.selector);
        vm.prank(owner);
        escrow.setPlugLevel(plug, 6);
    }

    function test_setPlugLevel_revertsOnZeroAddress() public {
        vm.expectRevert(IDealEscrowTypes.ZeroAddress.selector);
        vm.prank(owner);
        escrow.setPlugLevel(address(0), 1);
    }

    // ------------------------------------------------------------ pause

    function test_pause_ownerTogglesAndEmits() public {
        vm.expectEmit(false, false, false, true, address(escrow));
        emit Pausable.Paused(owner);
        vm.prank(owner);
        escrow.pause();
        assertTrue(escrow.paused());

        vm.expectEmit(false, false, false, true, address(escrow));
        emit Pausable.Unpaused(owner);
        vm.prank(owner);
        escrow.unpause();
        assertFalse(escrow.paused());
    }

    function test_pause_revertsForNonOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        escrow.pause();
    }

    // ------------------------------------------------------------ ownership

    function test_ownership_twoStepTransfer() public {
        address next = makeAddr("next");
        vm.prank(owner);
        escrow.transferOwnership(next);
        assertEq(escrow.owner(), owner);
        vm.prank(next);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), next);
    }

    function test_renounceOwnership_disabled() public {
        vm.expectRevert(IDealEscrowTypes.RenounceDisabled.selector);
        vm.prank(owner);
        escrow.renounceOwnership();
        assertEq(escrow.owner(), owner);
    }

    // ------------------------------------------------------------ sweep

    function testFuzz_sweepExcess_movesStrayUsdcOnly(uint256 stray) public {
        stray = bound(stray, 1, 1_000_000e6);
        usdc.mint(address(escrow), stray);
        address treasury = makeAddr("treasury");

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IDealEscrowTypes.ExcessSwept(treasury, stray);
        vm.prank(owner);
        escrow.sweepExcess(treasury);

        assertEq(usdc.balanceOf(treasury), stray);
        assertEq(usdc.balanceOf(address(escrow)), escrow.totalHeld());
    }

    function test_sweepExcess_revertsWhenNothingExtra() public {
        vm.expectRevert(IDealEscrowTypes.NothingToSweep.selector);
        vm.prank(owner);
        escrow.sweepExcess(owner);
    }

    function test_sweepExcess_revertsOnZeroAddress() public {
        usdc.mint(address(escrow), 1);
        vm.expectRevert(IDealEscrowTypes.ZeroAddress.selector);
        vm.prank(owner);
        escrow.sweepExcess(address(0));
    }

    function test_sweepExcess_revertsForNonOwner() public {
        usdc.mint(address(escrow), 1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        escrow.sweepExcess(stranger);
    }

    // ------------------------------------------------------------ release nonces

    function test_cancelNonce_incrementsAndEmits() public {
        address buyer = makeAddr("buyer");
        vm.expectEmit(true, false, false, true, address(escrow));
        emit IDealEscrowTypes.NonceCancelled(buyer, 0);
        vm.prank(buyer);
        escrow.cancelNonce();
        assertEq(escrow.releaseNonce(buyer), 1);
        assertEq(escrow.releaseNonce(stranger), 0);
    }

    // ------------------------------------------------------------ deal ids

    function testFuzz_dealIdOf_uniquePerSellerAndOrder(address a, address b, bytes32 orderId) public view {
        vm.assume(a != b);
        assertTrue(escrow.dealIdOf(a, orderId) != escrow.dealIdOf(b, orderId));
        assertEq(escrow.dealIdOf(a, orderId), uint256(keccak256(abi.encode(a, orderId))));
    }

    // ------------------------------------------------------------ EIP-712

    function test_typehashes_matchSigningTypes() public view {
        assertEq(
            escrow.TERMS_TYPEHASH(),
            keccak256(
                "Terms(address seller,address plug,bytes32 orderId,uint256 price,uint256 plugFee,uint32 windowSeconds,uint64 expiry,bytes32 metadataHash)"
            )
        );
        assertEq(escrow.ACCEPT_TYPEHASH(), keccak256("Accept(bytes32 termsHash,address plug)"));
        assertEq(
            escrow.RELEASE_TYPEHASH(),
            keccak256("Release(uint256 dealId,address buyer,uint256 amount,uint256 nonce,uint256 deadline)")
        );
    }

    function test_domain_nameVersionChainContract() public {
        vm.chainId(ARC_MAINNET);
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = escrow.eip712Domain();
        assertEq(name, "DealEscrow");
        assertEq(version, "1");
        assertEq(chainId, ARC_MAINNET);
        assertEq(verifying, address(escrow));
    }

    function test_termsDigest_matchesHandBuiltDigest() public {
        vm.chainId(ARC_MAINNET);
        IDealEscrowTypes.Terms memory t = _terms();
        bytes32 structHash = keccak256(
            abi.encode(
                escrow.TERMS_TYPEHASH(),
                t.seller,
                t.plug,
                t.orderId,
                t.price,
                t.plugFee,
                t.windowSeconds,
                t.expiry,
                t.metadataHash
            )
        );
        assertEq(escrow.termsHash(t), structHash);
        assertEq(escrow.termsDigest(t), keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash)));
    }

    function test_acceptAndReleaseDigests_matchHandBuilt() public {
        vm.chainId(ARC_MAINNET);
        bytes32 th = escrow.termsHash(_terms());
        assertEq(
            escrow.acceptDigest(th, plug),
            keccak256(
                abi.encodePacked(
                    "\x19\x01", _domainSeparator(), keccak256(abi.encode(escrow.ACCEPT_TYPEHASH(), th, plug))
                )
            )
        );
        address buyer = makeAddr("buyer");
        assertEq(
            escrow.releaseDigest(7, buyer, 5_075_000, 0, 1_800_000_000),
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    _domainSeparator(),
                    keccak256(
                        abi.encode(
                            escrow.RELEASE_TYPEHASH(),
                            uint256(7),
                            buyer,
                            uint256(5_075_000),
                            uint256(0),
                            uint256(1_800_000_000)
                        )
                    )
                )
            )
        );
    }

    function test_digest_bindsChainAndContract() public {
        IDealEscrowTypes.Terms memory t = _terms();
        vm.chainId(ARC_MAINNET);
        bytes32 onMainnet = escrow.termsDigest(t);
        vm.chainId(5042002);
        assertTrue(escrow.termsDigest(t) != onMainnet, "chain id not bound");
        vm.chainId(ARC_MAINNET);
        DealEscrow other = new DealEscrow(IERC20(address(usdc)), owner);
        assertTrue(other.termsDigest(t) != onMainnet, "contract not bound");
    }

    function testFuzz_termsDigest_changesWithEveryField(uint256 newPrice, uint32 newWindow) public view {
        IDealEscrowTypes.Terms memory t = _terms();
        bytes32 base = escrow.termsDigest(t);
        vm.assume(newPrice != t.price && newWindow != t.windowSeconds);
        IDealEscrowTypes.Terms memory p = _terms();
        p.price = newPrice;
        assertTrue(escrow.termsDigest(p) != base);
        IDealEscrowTypes.Terms memory w = _terms();
        w.windowSeconds = newWindow;
        assertTrue(escrow.termsDigest(w) != base);
    }

    function test_signatures_roundTripForSellerAndPlug() public {
        vm.chainId(ARC_MAINNET);
        (address seller, uint256 sellerKey) = makeAddrAndKey("seller");
        (address plugAddr, uint256 plugKey) = makeAddrAndKey("plug-signer");
        IDealEscrowTypes.Terms memory t = _terms();
        t.seller = seller;
        t.plug = plugAddr;

        bytes32 digest = escrow.termsDigest(t);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sellerKey, digest);
        assertTrue(SignatureChecker.isValidSignatureNow(seller, digest, abi.encodePacked(r, s, v)));
        assertFalse(SignatureChecker.isValidSignatureNow(plugAddr, digest, abi.encodePacked(r, s, v)));

        bytes32 accept = escrow.acceptDigest(escrow.termsHash(t), plugAddr);
        (v, r, s) = vm.sign(plugKey, accept);
        assertTrue(SignatureChecker.isValidSignatureNow(plugAddr, accept, abi.encodePacked(r, s, v)));
    }

    // ------------------------------------------------------------ helpers

    function _terms() internal view returns (IDealEscrowTypes.Terms memory) {
        return IDealEscrowTypes.Terms({
            seller: sellerAddr,
            plug: plug,
            orderId: keccak256("order-1"),
            price: 5e6,
            plugFee: 150_000,
            windowSeconds: 3 days,
            expiry: 1_800_000_000,
            metadataHash: keccak256("job description")
        });
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("DealEscrow"),
                keccak256("1"),
                block.chainid,
                address(escrow)
            )
        );
    }
}
