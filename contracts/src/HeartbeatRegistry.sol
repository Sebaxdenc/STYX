// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IEnrollment} from "./IEnrollment.sol";

/// @title HeartbeatRegistry
/// @notice Phase 2 of STYX: the qualification window.
///
/// Issues unpredictable challenges and records timely responses. Its primary
/// purpose is NOT to impose cost: it is to produce the per-wallet timing series
/// that the coordination detector analyses. The cost it imposes is secondary and
/// modest. See ARCHITECTURE.md section 3.
///
/// Design notes that matter:
///
/// 1. The window is split into `challengeCount` equal sub-windows and exactly one
///    challenge fires per cohort per sub-window. The COUNT is therefore
///    deterministic while the TIMING stays unpredictable, because the challenge
///    block derives from the hash of the sub-window's first block. A deterministic
///    count means scores are comparable across cohorts with no shared counter, so
///    there is no hot storage slot. See invariant 4 in AGENTS.md.
///
/// 2. Responses write only to the caller's own bitmap slot. Writes are disjoint,
///    which is the ideal case for Monad's optimistic parallel execution.
///
/// 3. Human interaction is mandatory. There is no puzzle to solve: the response is
///    a plain transaction, a tap in the client. Automatic background responses are
///    forbidden because latency would then measure the machine rather than the
///    person, destroying the variance signal. See invariant 11 in AGENTS.md.
contract HeartbeatRegistry {
    error NotOpen();
    error AlreadyOpen();
    error EnrollmentNotClosed();
    error WindowOver();
    error Unauthorized();
    error NotEnrolled();
    error InvalidRound(uint8 round);
    error ChallengeNotIssued();
    error ResponseTooLate(uint256 deadline, uint256 current);
    error AlreadyResponded(uint8 round);
    error ChallengeUnverifiable();
    error InvalidConfig();

    event QualificationOpened(uint256 startBlock, uint256 endBlock);
    event Heartbeat(
        address indexed participant,
        uint16 indexed cohort,
        uint8 indexed round,
        uint256 challengeBlock,
        uint256 responseBlock,
        uint32 latencyBlocks
    );

    address public immutable admin;
    IEnrollment public immutable enrollment;

    uint16 public immutable cohortCount;
    uint8 public immutable challengeCount;
    uint32 public immutable subWindowBlocks;
    uint32 public immutable responseWindowBlocks;
    uint8 public immutable minResponsesToQualify;

    /// @notice Block at which the qualification window opened. Zero until opened.
    uint256 public windowStartBlock;

    /// @notice Copy of the enrolment cohort seed, cached when the window opens.
    /// @dev Cached deliberately: `respond` runs up to 100k times per round, and
    ///      reading the seed over an external call on every one of them is pure
    ///      waste. The seed is immutable in `Enrollment` once set.
    bytes32 public cohortSeed;

    /// @dev Bit `r` set means the participant answered round `r`.
    mapping(address => uint16) private _responseBits;

    constructor(
        address enrollment_,
        uint16 cohortCount_,
        uint8 challengeCount_,
        uint32 subWindowBlocks_,
        uint32 responseWindowBlocks_,
        uint8 minResponsesToQualify_
    ) {
        // The bitmap is uint16, so at most 16 rounds. A challenge must fit inside
        // its sub-window together with its response window, and cohorts must be
        // able to occupy distinct offsets.
        if (
            enrollment_ == address(0) || cohortCount_ == 0 || challengeCount_ == 0
                || challengeCount_ > 16 || subWindowBlocks_ <= responseWindowBlocks_
                || responseWindowBlocks_ == 0 || minResponsesToQualify_ > challengeCount_
        ) {
            revert InvalidConfig();
        }

        admin = msg.sender;
        enrollment = IEnrollment(enrollment_);
        cohortCount = cohortCount_;
        challengeCount = challengeCount_;
        subWindowBlocks = subWindowBlocks_;
        responseWindowBlocks = responseWindowBlocks_;
        minResponsesToQualify = minResponsesToQualify_;
    }

    // ---------------------------------------------------------------- lifecycle

    function openQualification() external {
        if (msg.sender != admin) revert Unauthorized();
        if (windowStartBlock != 0) revert AlreadyOpen();

        bytes32 seed = enrollment.cohortSeed();
        if (seed == bytes32(0)) revert EnrollmentNotClosed();

        cohortSeed = seed;
        windowStartBlock = block.number;
        emit QualificationOpened(block.number, windowEndBlock());
    }

    // ------------------------------------------------------------- participation

    /// @notice Answer the challenge of `round` for the caller's cohort.
    /// @dev One storage write, to a slot owned exclusively by the caller.
    function respond(uint8 round) external {
        uint256 start = windowStartBlock;
        if (start == 0) revert NotOpen();
        if (round >= challengeCount) revert InvalidRound(round);
        if (!enrollment.isEnrolled(msg.sender)) revert NotEnrolled();

        uint16 bits = _responseBits[msg.sender];
        uint16 mask = uint16(1) << round;
        if (bits & mask != 0) revert AlreadyResponded(round);

        uint16 cohort = cohortOf(msg.sender);
        uint256 challengeBlock = challengeBlockOf(cohort, round);
        if (challengeBlock == 0) revert ChallengeUnverifiable();
        if (block.number <= challengeBlock) revert ChallengeNotIssued();

        uint256 deadline = challengeBlock + responseWindowBlocks;
        if (block.number > deadline) revert ResponseTooLate(deadline, block.number);

        _responseBits[msg.sender] = bits | mask;

        emit Heartbeat(
            msg.sender,
            cohort,
            round,
            challengeBlock,
            block.number,
            uint32(block.number - challengeBlock)
        );
    }

    // ----------------------------------------------------------------- views

    /// @notice Cohort of a participant, derived from the seed fixed at enrolment
    ///         close so that addresses cannot be ground out in advance.
    function cohortOf(address participant) public view returns (uint16) {
        return uint16(uint256(keccak256(abi.encodePacked(cohortSeed, participant))) % cohortCount);
    }

    /// @notice Block at which `round`'s challenge fires for `cohort`.
    /// @return Zero when the sub-window has not started yet, or when the
    ///         sub-window start is older than the 256-block hash window and the
    ///         value can therefore no longer be verified on chain.
    /// @dev Unpredictable because it derives from the hash of the sub-window's
    ///      first block, which does not exist until that block is produced. This
    ///      is what stops an adversary from scheduling a cron and sleeping.
    function challengeBlockOf(uint16 cohort, uint8 round) public view returns (uint256) {
        uint256 start = windowStartBlock;
        if (start == 0 || round >= challengeCount) return 0;

        uint256 subWindowStart = start + uint256(round) * subWindowBlocks;
        bytes32 h = blockhash(subWindowStart);
        if (h == bytes32(0)) return 0;

        // Leave room for the full response window inside the sub-window.
        uint256 span = subWindowBlocks - responseWindowBlocks;
        uint256 offset = uint256(keccak256(abi.encodePacked(h, cohort))) % span;
        return subWindowStart + 1 + offset;
    }

    function windowEndBlock() public view returns (uint256) {
        uint256 start = windowStartBlock;
        if (start == 0) return 0;
        return start + uint256(challengeCount) * subWindowBlocks;
    }

    function isOpen() external view returns (bool) {
        uint256 start = windowStartBlock;
        return start != 0 && block.number < windowEndBlock();
    }

    /// @notice Number of challenges answered. Weighting is capped in `Lottery`.
    function participationScore(address participant) external view returns (uint8) {
        return _popcount(_responseBits[participant]);
    }

    function hasResponded(address participant, uint8 round) external view returns (bool) {
        if (round >= challengeCount) return false;
        return _responseBits[participant] & (uint16(1) << round) != 0;
    }

    function responseBits(address participant) external view returns (uint16) {
        return _responseBits[participant];
    }

    function isQualified(address participant) external view returns (bool) {
        return _popcount(_responseBits[participant]) >= minResponsesToQualify;
    }

    /// @dev SWAR population count over 16 bits.
    function _popcount(uint16 x) internal pure returns (uint8) {
        uint256 v = x;
        v = v - ((v >> 1) & 0x5555);
        v = (v & 0x3333) + ((v >> 2) & 0x3333);
        v = (v + (v >> 4)) & 0x0f0f;
        return uint8(((v * 0x0101) >> 8) & 0xff);
    }
}
