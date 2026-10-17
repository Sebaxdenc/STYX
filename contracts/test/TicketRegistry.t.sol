// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DemoIdentityVerifier, TicketRegistry} from "../src/TicketRegistry.sol";
import {ContractHolder, MockClusters, MockLottery} from "./mocks.sol";

contract TicketRegistryTest is Test {
    MockLottery internal lot;
    MockClusters internal cl;
    DemoIdentityVerifier internal verifier;
    TicketRegistry internal reg;

    uint256 internal constant PRICE = 0;
    uint256 internal constant DISPUTE_WINDOW = 20;

    address internal alice = makeAddr("alice");
    address internal bot = makeAddr("bot");
    address internal bystander = makeAddr("bystander");

    bytes32 internal aliceSecret = keccak256("documento-de-alice");
    bytes32 internal aliceNullifier = keccak256(abi.encodePacked(keccak256("documento-de-alice")));

    function setUp() public {
        lot = new MockLottery();
        cl = new MockClusters();
        verifier = new DemoIdentityVerifier();
        reg =
            new TicketRegistry(address(lot), address(cl), address(verifier), PRICE, DISPUTE_WINDOW);

        lot.setEntitlement(alice, true);
        lot.setEntitlement(bot, true);
    }

    function _claim(address who, bytes32 nullifier) internal {
        vm.prank(who);
        reg.claimTicket{value: PRICE}(nullifier);
    }

    // ------------------------------------------------------------ happy path

    function test_claim_startsProvisionalNotFinal() public {
        _claim(alice, aliceNullifier);

        assertEq(uint8(reg.stateOf(alice)), uint8(TicketRegistry.State.Provisional));
        assertTrue(reg.isProvisional(alice));
        assertEq(reg.nullifierOf(alice), aliceNullifier);
        assertEq(reg.issued(), 1);
    }

    function test_finalize_afterDisputeWindow() public {
        _claim(alice, aliceNullifier);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.prank(bystander); // permissionless
        reg.finalize(alice);

        assertEq(uint8(reg.stateOf(alice)), uint8(TicketRegistry.State.Final));
    }

    function test_redeem_withBoundIdentity() public {
        _claim(alice, aliceNullifier);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        reg.finalize(alice);

        vm.prank(alice);
        reg.redeem(keccak256("reto-de-la-puerta"), abi.encode(aliceSecret));

        assertEq(uint8(reg.stateOf(alice)), uint8(TicketRegistry.State.Redeemed));
    }

    // ----------------------------------------------- the point of the design

    function test_sellingTheWalletDoesNotTransferAdmission() public {
        // La propiedad central de la Fase 4. El comprador de la wallet tiene la
        // llave, pero no el documento de Alice, asi que no puede entrar.
        _claim(alice, aliceNullifier);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        reg.finalize(alice);

        bytes32 otherSecret = keccak256("documento-del-comprador");
        vm.prank(alice); // misma wallet, otra persona tras ella
        vm.expectRevert(TicketRegistry.InvalidIdentityProof.selector);
        reg.redeem(keccak256("reto-de-la-puerta"), abi.encode(otherSecret));
    }

    function test_contractCustodyIsRejected() public {
        // Una cuenta de contrato se puede vender atomicamente, lo que devolveria
        // la entrada a ser un instrumento al portador.
        ContractHolder holder = new ContractHolder();
        lot.setEntitlement(address(holder), true);

        vm.expectRevert(TicketRegistry.ContractCustodyForbidden.selector);
        holder.claim{value: PRICE}(address(reg), keccak256("x"));
    }

    function test_oneTicketPerIdentityNotPerWallet() public {
        // Un limite por wallet no es ningun limite: las wallets son gratis.
        _claim(alice, aliceNullifier);

        address secondWallet = makeAddr("alice-segunda-wallet");
        lot.setEntitlement(secondWallet, true);

        vm.prank(secondWallet);
        vm.expectRevert(TicketRegistry.IdentityAlreadyUsed.selector);
        reg.claimTicket{value: PRICE}(aliceNullifier);
    }

    // -------------------------------------------------------------- revocation

    function test_revoke_flaggedHolderDuringDisputeWindow() public {
        _claim(bot, keccak256("nullifier-bot"));
        cl.setFinding(true);
        cl.setFlagged(bot, true);

        vm.prank(bystander); // permissionless
        reg.revoke(bot);

        assertEq(uint8(reg.stateOf(bot)), uint8(TicketRegistry.State.Revoked));
        assertFalse(reg.isValid(bot));
        assertEq(reg.revoked(), 1);
        assertEq(reg.activeTickets(), 0);
    }

    function test_revoke_releasesTheIdentityForReissue() public {
        // Un honesto mal atrapado en un cluster debe poder reemitir tras ganar
        // la apelacion.
        bytes32 nullifier = keccak256("nullifier-victima");
        _claim(bot, nullifier);
        cl.setFinding(true);
        cl.setFlagged(bot, true);
        reg.revoke(bot);

        address reissued = makeAddr("wallet-reemitida");
        lot.setEntitlement(reissued, true);
        vm.prank(reissued);
        reg.claimTicket{value: PRICE}(nullifier);

        assertEq(uint8(reg.stateOf(reissued)), uint8(TicketRegistry.State.Provisional));
    }

    function test_revoke_revertsWithoutFinding() public {
        _claim(bot, keccak256("n"));
        cl.setFlagged(bot, true); // marcado pero sin hallazgo comprometido

        vm.expectRevert(TicketRegistry.NotFlagged.selector);
        reg.revoke(bot);
    }

    function test_revoke_revertsForCleanHolder() public {
        _claim(alice, aliceNullifier);
        cl.setFinding(true);

        vm.expectRevert(TicketRegistry.NotFlagged.selector);
        reg.revoke(alice);
    }

    function test_revoke_revertsAfterDisputeWindow() public {
        _claim(bot, keccak256("n"));
        cl.setFinding(true);
        cl.setFlagged(bot, true);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                TicketRegistry.DisputeWindowOver.selector, reg.disputeDeadline(bot)
            )
        );
        reg.revoke(bot);
    }

    function test_finalize_revertsForFlaggedHolder() public {
        // No se puede convertir en definitiva una entrada marcada: hay que
        // levantar el hallazgo por apelacion primero.
        _claim(bot, keccak256("n"));
        cl.setFinding(true);
        cl.setFlagged(bot, true);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.expectRevert(TicketRegistry.NotFlagged.selector);
        reg.finalize(bot);
    }

    function test_finalize_worksAfterAppealLiftsTheFlag() public {
        _claim(bot, keccak256("n"));
        cl.setFinding(true);
        cl.setFlagged(bot, true);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        cl.setFlagged(bot, false); // apelacion estimada
        reg.finalize(bot);

        assertEq(uint8(reg.stateOf(bot)), uint8(TicketRegistry.State.Final));
    }

    // --------------------------------------------------------------- reverts

    function test_claim_revertsWithoutEntitlement() public {
        vm.prank(bystander);
        vm.expectRevert(TicketRegistry.NoEntitlement.selector);
        reg.claimTicket{value: PRICE}(keccak256("n"));
    }

    function test_claim_revertsTwice() public {
        _claim(alice, aliceNullifier);
        vm.prank(alice);
        vm.expectRevert(TicketRegistry.AlreadyClaimed.selector);
        reg.claimTicket{value: PRICE}(keccak256("otro"));
    }

    function test_claim_revertsOnEmptyNullifier() public {
        vm.prank(alice);
        vm.expectRevert(TicketRegistry.EmptyNullifier.selector);
        reg.claimTicket{value: PRICE}(bytes32(0));
    }

    function test_finalize_revertsWhileDisputeWindowOpen() public {
        _claim(alice, aliceNullifier);
        vm.expectRevert(
            abi.encodeWithSelector(
                TicketRegistry.DisputeWindowOpen.selector, reg.disputeDeadline(alice)
            )
        );
        reg.finalize(alice);
    }

    function test_redeem_revertsWhileProvisional() public {
        _claim(alice, aliceNullifier);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                TicketRegistry.NotRedeemable.selector, TicketRegistry.State.Provisional
            )
        );
        reg.redeem(keccak256("reto"), abi.encode(aliceSecret));
    }

    function test_redeem_revertsTwice() public {
        _claim(alice, aliceNullifier);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        reg.finalize(alice);
        vm.prank(alice);
        reg.redeem(keccak256("reto"), abi.encode(aliceSecret));

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                TicketRegistry.NotRedeemable.selector, TicketRegistry.State.Redeemed
            )
        );
        reg.redeem(keccak256("reto-2"), abi.encode(aliceSecret));
    }

    function test_redeem_revertsOnEmptyGateChallenge() public {
        _claim(alice, aliceNullifier);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        reg.finalize(alice);

        vm.prank(alice);
        vm.expectRevert(TicketRegistry.InvalidIdentityProof.selector);
        reg.redeem(bytes32(0), abi.encode(aliceSecret));
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzz_onlyBoundIdentityCanRedeem(bytes32 secret) public {
        vm.assume(keccak256(abi.encodePacked(secret)) != aliceNullifier);
        _claim(alice, aliceNullifier);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        reg.finalize(alice);

        vm.prank(alice);
        vm.expectRevert(TicketRegistry.InvalidIdentityProof.selector);
        reg.redeem(keccak256("reto"), abi.encode(secret));
    }

    function testFuzz_stateMachineNeverSkipsProvisional(address who) public {
        vm.assume(who != address(0) && who.code.length == 0);
        assertEq(uint8(reg.stateOf(who)), uint8(TicketRegistry.State.None));

        vm.prank(who);
        vm.expectRevert();
        reg.redeem(keccak256("reto"), abi.encode(bytes32(0)));
    }

    receive() external payable {}
}
