// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Lottery} from "../src/Lottery.sol";
import {MockClusterRegistry, MockEnrollment, MockHeartbeatRegistry} from "./mocks.sol";

contract LotteryTest is Test {
    MockEnrollment internal enr;
    MockHeartbeatRegistry internal hb;
    MockClusterRegistry internal cl;
    Lottery internal lot;

    uint256 internal constant INVENTORY = 100;
    uint8 internal constant CAP = 8;
    uint256 internal constant ROUND_BLOCKS = 200;

    function setUp() public {
        vm.roll(1000);
        enr = new MockEnrollment();
        hb = new MockHeartbeatRegistry();
        cl = new MockClusterRegistry();
        hb.setWindowEndBlock(1100);
        lot = new Lottery(address(enr), address(hb), address(cl), INVENTORY, CAP, ROUND_BLOCKS);
    }

    function _qualify(uint256 count, uint8 score) internal returns (address[] memory people) {
        people = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            address who = address(uint160(0x10000 + i));
            people[i] = who;
            enr.setEnrolled(who, true);
            hb.setQualified(who, true, score);
        }
        enr.setEnrolledCount(count);
    }

    function _startDraw() internal {
        vm.roll(hb.windowEndBlock() + 1);
        lot.requestSeed();
        vm.roll(block.number + lot.SEED_DELAY_BLOCKS() + 1);
        lot.finalizeSeed();
    }

    // ------------------------------------------------------------ happy path

    function test_fullDraw_fillsInventoryAcrossRounds() public {
        address[] memory people = _qualify(1000, CAP);
        _startDraw();

        uint256 claimed;
        for (uint8 round = 1; round <= lot.MAX_ROUNDS(); round++) {
            if (lot.phase() == Lottery.Phase.Closed) break;
            for (uint256 i = 0; i < people.length; i++) {
                if (lot.hasEntitlement(people[i])) continue;
                if (!lot.isSelected(people[i], lot.currentRound())) continue;
                if (lot.remainingInventory() == 0) break;
                vm.prank(people[i]);
                lot.claimEntitlement();
                claimed++;
            }
            vm.roll(block.number + ROUND_BLOCKS + 1);
            lot.advanceRound();
        }

        assertEq(claimed, lot.issued());
        assertGt(claimed, (INVENTORY * 90) / 100, "varias rondas deben casi llenar el inventario");
        assertLe(claimed, INVENTORY, "nunca por encima del inventario");
    }

    function test_selectionIsDeterministicAndRecomputable() public {
        address[] memory people = _qualify(50, CAP);
        _startDraw();

        // Mismo resultado leido dos veces, y recomputable por cualquiera.
        for (uint256 i = 0; i < people.length; i++) {
            bool first = lot.isSelected(people[i], 1);
            bool second = lot.isSelected(people[i], 1);
            assertEq(first, second);
        }
    }

    function test_claimingLateDoesNotLose() public {
        // La propiedad central: reclamar es recoger, no competir.
        address[] memory people = _qualify(200, CAP);
        _startDraw();

        address winner;
        for (uint256 i = 0; i < people.length; i++) {
            if (lot.isSelected(people[i], 1)) {
                winner = people[i];
                break;
            }
        }
        require(winner != address(0), "necesitamos un ganador");

        // Otros reclaman antes; no afecta al resultado del rezagado.
        for (uint256 i = 0; i < people.length; i++) {
            if (people[i] == winner) continue;
            if (!lot.isSelected(people[i], 1)) continue;
            if (lot.remainingInventory() <= 1) break;
            vm.prank(people[i]);
            lot.claimEntitlement();
        }

        vm.prank(winner);
        lot.claimEntitlement();
        assertTrue(lot.hasEntitlement(winner));
    }

    // -------------------------------------------------------------- weighting

    function test_weightIsCapped() public {
        address who = address(uint160(0x777));
        hb.setQualified(who, true, 10); // por encima del tope de 8
        assertEq(lot.weightOf(who), CAP, "la participacion perfecta no supera el tope");
    }

    function test_clusterFindingReducesWeightButNeverZeroesIt() public {
        address who = address(uint160(0x888));
        hb.setQualified(who, true, CAP);
        cl.setMultiplier(who, 2500);

        uint256 weight = lot.weightOf(who);
        assertEq(weight, (CAP * 2500) / 10_000);
        assertGt(weight, 0, "invariante 3: reduce, nunca excluye");
    }

    function test_lowerParticipationLowersSelectionOdds() public {
        // Con la misma semilla, un score menor implica un limite menor.
        _qualify(500, CAP);
        _startDraw();

        uint256 highWins;
        uint256 lowWins;
        for (uint256 i = 0; i < 500; i++) {
            address who = address(uint160(0x10000 + i));
            hb.setQualified(who, true, CAP);
            if (lot.isSelected(who, 1)) highWins++;
            hb.setQualified(who, true, 2);
            if (lot.isSelected(who, 1)) lowWins++;
        }

        assertGt(highWins, lowWins, "mas participacion, mas probabilidad");
    }

    // -------------------------------------------------------------- reverts

    function test_requestSeed_revertsBeforeQualificationEnds() public {
        vm.expectRevert(Lottery.QualificationNotOver.selector);
        lot.requestSeed();
    }

    function test_finalizeSeed_revertsTooEarly() public {
        vm.roll(hb.windowEndBlock() + 1);
        lot.requestSeed();
        vm.expectRevert(abi.encodeWithSelector(Lottery.SeedNotReady.selector, lot.seedBlock() + 1));
        lot.finalizeSeed();
    }

    function test_finalizeSeed_revertsAfterHashWindow() public {
        vm.roll(hb.windowEndBlock() + 1);
        lot.requestSeed();
        vm.roll(lot.seedBlock() + lot.SEED_VALIDITY_BLOCKS() + 2);
        vm.expectRevert(Lottery.SeedExpired.selector);
        lot.finalizeSeed();
    }

    function test_reRequestSeed_recoversFromExpiry() public {
        vm.roll(hb.windowEndBlock() + 1);
        lot.requestSeed();
        vm.roll(lot.seedBlock() + lot.SEED_VALIDITY_BLOCKS() + 2);

        lot.reRequestSeed();
        vm.roll(lot.seedBlock() + 1);
        lot.finalizeSeed();

        assertTrue(lot.seed() != bytes32(0));
    }

    function test_claim_revertsForUnqualified() public {
        _qualify(100, CAP);
        _startDraw();
        address stranger = makeAddr("stranger");

        vm.prank(stranger);
        vm.expectRevert(Lottery.NotQualified.selector);
        lot.claimEntitlement();
    }

    function test_claim_revertsWhenNotSelected() public {
        address[] memory people = _qualify(500, CAP);
        _startDraw();

        address loser;
        for (uint256 i = 0; i < people.length; i++) {
            if (!lot.isSelected(people[i], 1)) {
                loser = people[i];
                break;
            }
        }
        require(loser != address(0), "necesitamos un no seleccionado");

        vm.prank(loser);
        vm.expectRevert(Lottery.NotSelected.selector);
        lot.claimEntitlement();
    }

    function test_claim_revertsTwice() public {
        address[] memory people = _qualify(200, CAP);
        _startDraw();

        address winner;
        for (uint256 i = 0; i < people.length; i++) {
            if (lot.isSelected(people[i], 1)) {
                winner = people[i];
                break;
            }
        }
        vm.prank(winner);
        lot.claimEntitlement();

        vm.prank(winner);
        vm.expectRevert(Lottery.AlreadyWon.selector);
        lot.claimEntitlement();
    }

    function test_claim_revertsAfterRoundCloses() public {
        address[] memory people = _qualify(200, CAP);
        _startDraw();

        address winner;
        for (uint256 i = 0; i < people.length; i++) {
            if (lot.isSelected(people[i], 1)) {
                winner = people[i];
                break;
            }
        }

        vm.roll(block.number + ROUND_BLOCKS + 1);
        vm.prank(winner);
        vm.expectRevert(Lottery.NoRoundOpen.selector);
        lot.claimEntitlement();
    }

    function test_advanceRound_revertsWhileRoundOpen() public {
        _qualify(100, CAP);
        _startDraw();
        vm.expectRevert(Lottery.RoundStillOpen.selector);
        lot.advanceRound();
    }

    function test_drawClosesAfterMaxRounds() public {
        // Pool declarado enorme para que la tasa por ronda quede diminuta, pero
        // sin crear las direcciones: el conteo lo expone el mock directamente.
        _qualify(20, CAP);
        enr.setEnrolledCount(100_000);
        _startDraw();

        for (uint8 i = 0; i < lot.MAX_ROUNDS(); i++) {
            vm.roll(block.number + ROUND_BLOCKS + 1);
            lot.advanceRound();
        }
        assertEq(uint8(lot.phase()), uint8(Lottery.Phase.Closed));
    }

    function test_constructor_rejectsInvalidConfig() public {
        vm.expectRevert(Lottery.InvalidConfig.selector);
        new Lottery(address(enr), address(hb), address(cl), 0, CAP, ROUND_BLOCKS);

        vm.expectRevert(Lottery.InvalidConfig.selector);
        new Lottery(address(enr), address(hb), address(cl), INVENTORY, 0, ROUND_BLOCKS);

        vm.expectRevert(Lottery.InvalidConfig.selector);
        new Lottery(address(0), address(hb), address(cl), INVENTORY, CAP, ROUND_BLOCKS);
    }

    // ------------------------------------------------------------------ fuzz

    /// @notice Requisito explicito de AGENTS.md: para cualquier conjunto de
    ///         participantes y cualquier aleatoriedad, nunca se emite mas que el
    ///         inventario y nadie recibe dos asignaciones.
    function testFuzz_neverOverAllocatesAndNeverDoubleAllocates(uint8 population, uint8 score)
        public
    {
        population = uint8(bound(population, 1, 200));
        score = uint8(bound(score, 1, 10));

        address[] memory people = _qualify(population, score);
        _startDraw();

        uint256 granted;
        for (uint8 round = 1; round <= lot.MAX_ROUNDS(); round++) {
            if (lot.phase() == Lottery.Phase.Closed) break;
            for (uint256 i = 0; i < people.length; i++) {
                if (lot.hasEntitlement(people[i])) continue;
                if (!lot.isSelected(people[i], lot.currentRound())) continue;
                if (lot.remainingInventory() == 0) break;
                vm.prank(people[i]);
                lot.claimEntitlement();
                granted++;
            }
            vm.roll(block.number + ROUND_BLOCKS + 1);
            lot.advanceRound();
        }

        assertLe(lot.issued(), INVENTORY, "entradas emitidas <= inventario");
        assertEq(lot.issued(), granted, "una asignacion por identidad");

        uint256 holders;
        for (uint256 i = 0; i < people.length; i++) {
            if (lot.hasEntitlement(people[i])) holders++;
        }
        assertEq(holders, lot.issued());
    }

    function testFuzz_zeroWeightIsNeverSelected(address participant, uint8 round) public {
        round = uint8(bound(round, 1, lot.MAX_ROUNDS()));
        _qualify(100, CAP);
        _startDraw();

        hb.setQualified(participant, true, 0);
        assertFalse(lot.isSelected(participant, round), "sin participacion no hay sorteo");
    }
}
