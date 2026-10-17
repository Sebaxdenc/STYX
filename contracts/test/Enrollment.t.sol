// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Enrollment} from "../src/Enrollment.sol";

contract EnrollmentTest is Test {
    Enrollment internal enr;

    uint256 internal constant BOND = 20 ether;
    uint256 internal constant WINDOW = 172_800;
    uint256 internal constant FORFEIT_BPS = 2500;

    address internal admin = address(this);
    address internal alice = makeAddr("alice");
    address internal bruno = makeAddr("bruno");
    address internal slasher = makeAddr("slasher");

    function setUp() public {
        enr = new Enrollment(BOND, WINDOW, FORFEIT_BPS);
        vm.deal(alice, 100 ether);
        vm.deal(bruno, 100 ether);
    }

    function _openAndEnroll(address who) internal {
        if (enr.phase() == Enrollment.Phase.Created) enr.openEnrollment();
        vm.prank(who);
        enr.enroll{value: BOND}();
    }

    // ------------------------------------------------------------ happy path

    function test_enroll_recordsBondAndCount() public {
        _openAndEnroll(alice);

        assertTrue(enr.isEnrolled(alice));
        assertEq(enr.bondOf(alice), BOND);
        assertEq(enr.enrolledCount(), 1);
    }

    function test_closeEnrollment_fixesCohortSeed() public {
        _openAndEnroll(alice);

        vm.warp(block.timestamp + WINDOW);
        vm.roll(block.number + 1);
        enr.closeEnrollment();

        assertTrue(enr.enrollmentClosed());
        assertTrue(enr.cohortSeed() != bytes32(0), "seed must be fixed at close");
    }

    function test_withdrawBond_returnsFullBond() public {
        _openAndEnroll(alice);
        vm.warp(block.timestamp + WINDOW);
        vm.roll(block.number + 1);
        enr.closeEnrollment();
        enr.settle();

        uint256 before = alice.balance;
        vm.prank(alice);
        enr.withdrawBond();

        assertEq(alice.balance - before, BOND, "honest participant is made whole");
        assertTrue(enr.hasWithdrawn(alice));
    }

    // -------------------------------------------------------- phase boundaries

    function test_enroll_revertsBeforeOpen() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                Enrollment.WrongPhase.selector, Enrollment.Phase.Enrolling, Enrollment.Phase.Created
            )
        );
        enr.enroll{value: BOND}();
    }

    function test_enroll_revertsAfterWindowElapsed() public {
        enr.openEnrollment();
        vm.warp(block.timestamp + WINDOW);

        vm.prank(alice);
        vm.expectRevert(Enrollment.EnrollmentWindowOver.selector);
        enr.enroll{value: BOND}();
    }

    function test_closeEnrollment_revertsWhileWindowOpen() public {
        enr.openEnrollment();
        vm.expectRevert(Enrollment.EnrollmentWindowStillOpen.selector);
        enr.closeEnrollment();
    }

    function test_closeEnrollment_callableByAnyone() public {
        // The schedule must not depend on an operator being online.
        _openAndEnroll(alice);
        vm.warp(block.timestamp + WINDOW);
        vm.roll(block.number + 1);

        vm.prank(bruno);
        enr.closeEnrollment();

        assertTrue(enr.enrollmentClosed());
    }

    function test_withdrawBond_revertsBeforeSettled() public {
        _openAndEnroll(alice);
        vm.warp(block.timestamp + WINDOW);
        vm.roll(block.number + 1);
        enr.closeEnrollment();

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                Enrollment.WrongPhase.selector, Enrollment.Phase.Settled, Enrollment.Phase.Closed
            )
        );
        enr.withdrawBond();
    }

    // -------------------------------------------------------------- reverts

    function test_enroll_revertsOnWrongBond() public {
        enr.openEnrollment();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Enrollment.IncorrectBond.selector, BOND, 1 ether));
        enr.enroll{value: 1 ether}();
    }

    function test_enroll_revertsOnDoubleEnrollment() public {
        _openAndEnroll(alice);
        vm.prank(alice);
        vm.expectRevert(Enrollment.AlreadyEnrolled.selector);
        enr.enroll{value: BOND}();
    }

    function test_openEnrollment_revertsForNonAdmin() public {
        vm.prank(alice);
        vm.expectRevert(Enrollment.Unauthorized.selector);
        enr.openEnrollment();
    }

    function test_withdrawBond_revertsOnDoubleWithdraw() public {
        _openAndEnroll(alice);
        vm.warp(block.timestamp + WINDOW);
        vm.roll(block.number + 1);
        enr.closeEnrollment();
        enr.settle();

        vm.prank(alice);
        enr.withdrawBond();
        vm.prank(alice);
        vm.expectRevert(Enrollment.NotEnrolled.selector);
        enr.withdrawBond();
    }

    function test_setSlasher_onlyOnce() public {
        enr.setSlasher(slasher);
        vm.expectRevert(Enrollment.SlasherAlreadySet.selector);
        enr.setSlasher(alice);
    }

    function test_forfeit_revertsForNonSlasher() public {
        _openAndEnroll(alice);
        enr.setSlasher(slasher);

        vm.prank(bruno);
        vm.expectRevert(Enrollment.Unauthorized.selector);
        enr.forfeit(alice);
    }

    function test_constructor_revertsOnForfeitAboveHundredPercent() public {
        vm.expectRevert(abi.encodeWithSelector(Enrollment.InvalidForfeitBps.selector, 10_001));
        new Enrollment(BOND, WINDOW, 10_001);
    }

    // -------------------------------------------------------------- forfeiture

    function test_forfeit_keepsConfiguredShareAndLeavesRemainder() public {
        _openAndEnroll(alice);
        enr.setSlasher(slasher);

        vm.prank(slasher);
        enr.forfeit(alice);

        uint256 kept = (BOND * FORFEIT_BPS) / 10_000;
        assertEq(enr.forfeitPool(), kept);
        // A confirmed finding prices the behaviour; it does not confiscate all.
        assertEq(enr.bondOf(alice), BOND - kept);
    }

    function test_forfeit_remainderStaysWithdrawable() public {
        _openAndEnroll(alice);
        enr.setSlasher(slasher);
        vm.prank(slasher);
        enr.forfeit(alice);

        vm.warp(block.timestamp + WINDOW);
        vm.roll(block.number + 1);
        enr.closeEnrollment();
        enr.settle();

        uint256 kept = (BOND * FORFEIT_BPS) / 10_000;
        uint256 before = alice.balance;
        vm.prank(alice);
        enr.withdrawBond();

        assertEq(alice.balance - before, BOND - kept);
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzz_enroll_bondMustMatchExactly(uint256 value) public {
        vm.assume(value != BOND && value < 1000 ether);
        enr.openEnrollment();
        vm.deal(alice, 1000 ether);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Enrollment.IncorrectBond.selector, BOND, value));
        enr.enroll{value: value}();
    }

    function testFuzz_contractHoldsSumOfBonds(uint8 participants) public {
        vm.assume(participants > 0 && participants <= 50);
        enr.openEnrollment();

        for (uint256 i = 0; i < participants; i++) {
            address p = address(uint160(0x1000 + i));
            vm.deal(p, BOND);
            vm.prank(p);
            enr.enroll{value: BOND}();
        }

        assertEq(address(enr).balance, BOND * participants);
        assertEq(enr.enrolledCount(), participants);
    }

    receive() external payable {}
}
