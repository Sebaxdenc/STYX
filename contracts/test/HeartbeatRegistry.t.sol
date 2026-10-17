// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {Enrollment} from "../src/Enrollment.sol";
import {HeartbeatRegistry} from "../src/HeartbeatRegistry.sol";

contract HeartbeatRegistryTest is Test {
    Enrollment internal enr;
    HeartbeatRegistry internal reg;

    uint256 internal constant BOND = 20 ether;
    uint256 internal constant ENROLL_WINDOW = 172_800;

    // Matches protocol-params.json.
    uint16 internal constant COHORTS = 20;
    uint8 internal constant CHALLENGES = 10;
    uint32 internal constant SUB_WINDOW = 100;
    uint32 internal constant RESPONSE_WINDOW = 33;
    uint8 internal constant MIN_RESPONSES = 6;

    address internal alice = makeAddr("alice");
    address internal bruno = makeAddr("bruno");

    event Heartbeat(
        address indexed participant,
        uint16 indexed cohort,
        uint8 indexed round,
        uint256 challengeBlock,
        uint256 responseBlock,
        uint32 latencyBlocks
    );

    function setUp() public {
        vm.roll(1000);
        enr = new Enrollment(BOND, ENROLL_WINDOW, 2500);
        enr.openEnrollment();
        _enroll(alice);
        _enroll(bruno);
        reg = _deployRegistry(COHORTS);
    }

    // ------------------------------------------------------------- harness

    function _enroll(address who) internal {
        vm.deal(who, BOND);
        vm.prank(who);
        enr.enroll{value: BOND}();
    }

    function _deployRegistry(uint16 cohorts) internal returns (HeartbeatRegistry) {
        return new HeartbeatRegistry(
            address(enr), cohorts, CHALLENGES, SUB_WINDOW, RESPONSE_WINDOW, MIN_RESPONSES
        );
    }

    function _closeEnrollmentAndOpen(HeartbeatRegistry r) internal {
        if (!enr.enrollmentClosed()) {
            vm.warp(block.timestamp + ENROLL_WINDOW);
            vm.roll(block.number + 1);
            enr.closeEnrollment();
        }
        r.openQualification();
        // blockhash(windowStart) only exists once that block is in the past.
        vm.roll(block.number + 1);
    }

    /// @dev Roll to the first block inside the response window of `round`.
    function _rollIntoResponseWindow(HeartbeatRegistry r, uint16 cohort, uint8 round)
        internal
        returns (uint256 challengeBlock)
    {
        uint256 subWindowStart = r.windowStartBlock() + uint256(round) * SUB_WINDOW;
        if (block.number <= subWindowStart) vm.roll(subWindowStart + 1);

        challengeBlock = r.challengeBlockOf(cohort, round);
        require(challengeBlock != 0, "challenge not computable");
        if (block.number <= challengeBlock) vm.roll(challengeBlock + 1);
    }

    // ------------------------------------------------------------ happy path

    function test_respond_recordsScoreAndLatency() public {
        _closeEnrollmentAndOpen(reg);
        uint16 cohort = reg.cohortOf(alice);
        uint256 cb = _rollIntoResponseWindow(reg, cohort, 0);

        vm.expectEmit(true, true, true, true);
        emit Heartbeat(alice, cohort, 0, cb, block.number, uint32(block.number - cb));

        vm.prank(alice);
        reg.respond(0);

        assertEq(reg.participationScore(alice), 1);
        assertTrue(reg.hasResponded(alice, 0));
    }

    function test_respond_acrossAllRoundsQualifies() public {
        _closeEnrollmentAndOpen(reg);
        uint16 cohort = reg.cohortOf(alice);

        for (uint8 round = 0; round < CHALLENGES; round++) {
            _rollIntoResponseWindow(reg, cohort, round);
            vm.prank(alice);
            reg.respond(round);
        }

        assertEq(reg.participationScore(alice), CHALLENGES);
        assertTrue(reg.isQualified(alice));
    }

    function test_isQualified_requiresMinimumResponses() public {
        _closeEnrollmentAndOpen(reg);
        uint16 cohort = reg.cohortOf(alice);

        for (uint8 round = 0; round < MIN_RESPONSES - 1; round++) {
            _rollIntoResponseWindow(reg, cohort, round);
            vm.prank(alice);
            reg.respond(round);
        }
        assertFalse(reg.isQualified(alice), "below threshold");

        _rollIntoResponseWindow(reg, cohort, MIN_RESPONSES - 1);
        vm.prank(alice);
        reg.respond(MIN_RESPONSES - 1);
        assertTrue(reg.isQualified(alice), "at threshold");
    }

    // ------------------------------------------------------- challenge timing

    function test_challengeBlock_staysInsideSubWindowLeavingRoomToRespond() public {
        _closeEnrollmentAndOpen(reg);

        for (uint8 round = 0; round < CHALLENGES; round++) {
            uint256 subWindowStart = reg.windowStartBlock() + uint256(round) * SUB_WINDOW;
            if (block.number <= subWindowStart) vm.roll(subWindowStart + 1);

            for (uint16 c = 0; c < COHORTS; c++) {
                uint256 cb = reg.challengeBlockOf(c, round);
                assertGt(cb, subWindowStart, "challenge must be after sub-window start");
                // The whole response window must fit inside the sub-window.
                assertLe(
                    cb + RESPONSE_WINDOW,
                    subWindowStart + SUB_WINDOW,
                    "response window must not overflow the sub-window"
                );
            }
        }
    }

    function test_challengeBlock_isZeroBeforeSubWindowStarts() public {
        _closeEnrollmentAndOpen(reg);
        // Round 9's sub-window has not been reached yet.
        assertEq(reg.challengeBlockOf(0, 9), 0);
    }

    function test_challengeBlock_differsAcrossCohorts() public {
        _closeEnrollmentAndOpen(reg);
        vm.roll(reg.windowStartBlock() + 1);

        uint256 distinct;
        uint256 first = reg.challengeBlockOf(0, 0);
        for (uint16 c = 1; c < COHORTS; c++) {
            if (reg.challengeBlockOf(c, 0) != first) distinct++;
        }
        // Cohorts are offset so that load is spread rather than bursty.
        assertGt(distinct, 0, "cohorts must not all fire on the same block");
    }

    // -------------------------------------------------------------- reverts

    function test_respond_revertsBeforeWindowOpens() public {
        vm.prank(alice);
        vm.expectRevert(HeartbeatRegistry.NotOpen.selector);
        reg.respond(0);
    }

    function test_respond_revertsForUnknownRound() public {
        _closeEnrollmentAndOpen(reg);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(HeartbeatRegistry.InvalidRound.selector, CHALLENGES));
        reg.respond(CHALLENGES);
    }

    function test_respond_revertsForNonEnrolled() public {
        _closeEnrollmentAndOpen(reg);
        address stranger = makeAddr("stranger");
        _rollIntoResponseWindow(reg, reg.cohortOf(stranger), 0);

        vm.prank(stranger);
        vm.expectRevert(HeartbeatRegistry.NotEnrolled.selector);
        reg.respond(0);
    }

    function test_respond_revertsOnDoubleResponse() public {
        _closeEnrollmentAndOpen(reg);
        _rollIntoResponseWindow(reg, reg.cohortOf(alice), 0);

        vm.prank(alice);
        reg.respond(0);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HeartbeatRegistry.AlreadyResponded.selector, uint8(0))
        );
        reg.respond(0);
    }

    function test_respond_revertsWhenTooLate() public {
        _closeEnrollmentAndOpen(reg);
        uint256 cb = _rollIntoResponseWindow(reg, reg.cohortOf(alice), 0);

        vm.roll(cb + RESPONSE_WINDOW + 1);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                HeartbeatRegistry.ResponseTooLate.selector, cb + RESPONSE_WINDOW, block.number
            )
        );
        reg.respond(0);
    }

    function test_respond_revertsOnSameBlockAsChallenge() public {
        _closeEnrollmentAndOpen(reg);
        uint16 cohort = reg.cohortOf(alice);
        uint256 subWindowStart = reg.windowStartBlock();
        vm.roll(subWindowStart + 1);
        uint256 cb = reg.challengeBlockOf(cohort, 0);
        vm.roll(cb);

        vm.prank(alice);
        vm.expectRevert(HeartbeatRegistry.ChallengeNotIssued.selector);
        reg.respond(0);
    }

    function test_openQualification_revertsForNonAdmin() public {
        vm.warp(block.timestamp + ENROLL_WINDOW);
        vm.roll(block.number + 1);
        enr.closeEnrollment();

        vm.prank(alice);
        vm.expectRevert(HeartbeatRegistry.Unauthorized.selector);
        reg.openQualification();
    }

    function test_openQualification_revertsBeforeEnrollmentCloses() public {
        vm.expectRevert(HeartbeatRegistry.EnrollmentNotClosed.selector);
        reg.openQualification();
    }

    function test_openQualification_revertsIfAlreadyOpen() public {
        _closeEnrollmentAndOpen(reg);
        vm.expectRevert(HeartbeatRegistry.AlreadyOpen.selector);
        reg.openQualification();
    }

    function test_constructor_rejectsInvalidConfig() public {
        // More rounds than the bitmap can hold.
        vm.expectRevert(HeartbeatRegistry.InvalidConfig.selector);
        new HeartbeatRegistry(address(enr), COHORTS, 17, SUB_WINDOW, RESPONSE_WINDOW, 6);

        // Response window does not fit inside the sub-window.
        vm.expectRevert(HeartbeatRegistry.InvalidConfig.selector);
        new HeartbeatRegistry(address(enr), COHORTS, CHALLENGES, 33, 33, 6);

        // Qualification threshold unreachable.
        vm.expectRevert(HeartbeatRegistry.InvalidConfig.selector);
        new HeartbeatRegistry(address(enr), COHORTS, CHALLENGES, SUB_WINDOW, RESPONSE_WINDOW, 11);
    }

    // ----------------------------------------------- adversary: swarm detection

    /// @notice The contract must capture latency at a resolution that separates a
    ///         coordinated swarm from independent participants. The clustering
    ///         itself runs off chain, so what is asserted here is that the signal
    ///         survives into the event log the indexer consumes.
    function test_adversary_swarmProducesZeroVarianceWhileHumansDoNot() public {
        // One cohort so every participant shares the same challenge block and the
        // latencies are directly comparable.
        HeartbeatRegistry single = _deployRegistry(1);

        uint256 n = 12;
        address[] memory bots = new address[](n);
        address[] memory humans = new address[](n);
        for (uint256 i = 0; i < n; i++) {
            bots[i] = address(uint160(0x100000 + i));
            humans[i] = address(uint160(0x200000 + i));
            _enroll(bots[i]);
            _enroll(humans[i]);
        }

        _closeEnrollmentAndOpen(single);
        uint256 cb = _rollIntoResponseWindow(single, 0, 0);

        vm.recordLogs();

        // The swarm: one orchestrator, every wallet fires in the same block.
        vm.roll(cb + 1);
        for (uint256 i = 0; i < n; i++) {
            vm.prank(bots[i]);
            single.respond(0);
        }

        // Independent participants: reaction time spreads out.
        uint256[12] memory humanDelay = [uint256(3), 7, 4, 11, 5, 9, 6, 14, 8, 4, 12, 7];
        for (uint256 i = 0; i < n; i++) {
            vm.roll(cb + humanDelay[i]);
            vm.prank(humans[i]);
            single.respond(0);
        }

        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint32 botMin = type(uint32).max;
        uint32 botMax;
        uint32 humanMin = type(uint32).max;
        uint32 humanMax;
        uint256 counted;

        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] != Heartbeat.selector) continue;
            address who = address(uint160(uint256(logs[i].topics[1])));
            (,, uint32 latency) = abi.decode(logs[i].data, (uint256, uint256, uint32));
            counted++;

            if (uint160(who) >= uint160(0x200000)) {
                if (latency < humanMin) humanMin = latency;
                if (latency > humanMax) humanMax = latency;
            } else {
                if (latency < botMin) botMin = latency;
                if (latency > botMax) botMax = latency;
            }
        }

        assertEq(counted, 2 * n, "every heartbeat must be logged");
        assertEq(botMax - botMin, 0, "swarm has zero latency spread");
        assertGt(humanMax - humanMin, 0, "independent participants have spread");
        assertGt(humanMin, botMax, "the swarm is strictly faster than any human");
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzz_popcountMatchesNaiveCount(uint16 bits) public {
        // participationScore relies on a SWAR popcount; verify against a loop.
        uint8 naive;
        for (uint256 i = 0; i < 16; i++) {
            if (bits & (uint16(1) << i) != 0) naive++;
        }

        PopcountHarness h = new PopcountHarness();
        assertEq(h.count(bits), naive);
    }

    function testFuzz_cohortIsAlwaysInRange(address participant) public {
        _closeEnrollmentAndOpen(reg);
        assertLt(reg.cohortOf(participant), COHORTS);
    }

    function testFuzz_respondOutsideResponseWindowAlwaysReverts(uint16 overshoot) public {
        vm.assume(overshoot > 0 && overshoot < SUB_WINDOW - RESPONSE_WINDOW);
        _closeEnrollmentAndOpen(reg);
        uint256 cb = _rollIntoResponseWindow(reg, reg.cohortOf(alice), 0);

        vm.roll(cb + RESPONSE_WINDOW + overshoot);
        vm.prank(alice);
        vm.expectRevert();
        reg.respond(0);
    }

    receive() external payable {}
}

/// @dev Exposes the internal popcount for differential testing.
contract PopcountHarness is HeartbeatRegistry {
    constructor() HeartbeatRegistry(address(1), 1, 1, 2, 1, 1) {}

    function count(uint16 x) external pure returns (uint8) {
        return _popcount(x);
    }
}
