// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IEnrollment} from "./IEnrollment.sol";

/// @title Enrollment
/// @notice Phase 1 of STYX: enrolment with a refundable bond.
///
/// The bond is not a bot filter. Its purpose is to bound how many identities an
/// adversary can field, which is what stops the lottery in `Lottery` from being
/// trivially sybil-attacked. An honest participant gets the bond back, so the
/// real cost is temporary liquidity.
///
/// Enrolling early confers no advantage. The window is deliberately long so that
/// no demand spike forms at the opening instant.
///
/// See ARCHITECTURE.md section 2. Parameters come from protocol-params.json.
contract Enrollment is IEnrollment {
    /// @dev Settled means the sale concluded and bonds may be withdrawn.
    enum Phase {
        Created,
        Enrolling,
        Closed,
        Settled
    }

    error WrongPhase(Phase expected, Phase actual);
    error AlreadyEnrolled();
    error NotEnrolled();
    error IncorrectBond(uint256 expected, uint256 provided);
    error EnrollmentWindowOver();
    error EnrollmentWindowStillOpen();
    error Unauthorized();
    error SlasherAlreadySet();
    error ZeroAddress();
    error AlreadyWithdrawn();
    error TransferFailed();
    error InvalidForfeitBps(uint256 bps);

    event EnrollmentOpened(uint256 openedAt, uint256 closesAt);
    event Enrolled(address indexed participant, uint256 bond);
    event EnrollmentClosed(uint256 enrolledCount, bytes32 cohortSeed);
    event Settled();
    event SlasherSet(address indexed slasher);
    event BondWithdrawn(address indexed participant, uint256 amount);
    event BondForfeited(address indexed participant, uint256 forfeited, uint256 remaining);

    uint256 private constant BPS_DENOMINATOR = 10_000;

    address public immutable admin;
    uint256 public immutable bondAmount;
    uint256 public immutable enrollmentWindowSeconds;
    /// @notice Share of the bond kept when a qualified identity is forfeited.
    uint256 public immutable abandonmentForfeitBps;

    Phase public phase;
    uint256 public closesAt;
    uint256 public enrolledCount;

    /// @notice Fixed at close so cohort assignment cannot be ground out in advance.
    bytes32 public cohortSeed;

    /// @notice Authorised to forfeit bonds. Set once, expected to be ClusterRegistry.
    address public slasher;

    /// @notice Accumulated forfeited value, withdrawable by admin after settlement.
    uint256 public forfeitPool;

    mapping(address => uint256) private _bond;
    mapping(address => bool) private _withdrawn;

    modifier atPhase(Phase expected) {
        if (phase != expected) revert WrongPhase(expected, phase);
        _;
    }

    constructor(
        uint256 bondAmount_,
        uint256 enrollmentWindowSeconds_,
        uint256 abandonmentForfeitBps_
    ) {
        if (abandonmentForfeitBps_ > BPS_DENOMINATOR) {
            revert InvalidForfeitBps(abandonmentForfeitBps_);
        }
        admin = msg.sender;
        bondAmount = bondAmount_;
        enrollmentWindowSeconds = enrollmentWindowSeconds_;
        abandonmentForfeitBps = abandonmentForfeitBps_;
        phase = Phase.Created;
    }

    // ---------------------------------------------------------------- lifecycle

    function openEnrollment() external atPhase(Phase.Created) {
        if (msg.sender != admin) revert Unauthorized();
        phase = Phase.Enrolling;
        closesAt = block.timestamp + enrollmentWindowSeconds;
        emit EnrollmentOpened(block.timestamp, closesAt);
    }

    /// @notice Close enrolment and fix the cohort seed.
    ///
    /// Callable by anyone once the window has elapsed, so the schedule does not
    /// depend on an operator being online.
    ///
    /// @dev The seed comes from the previous block hash. A proposer could bias it
    ///      marginally, but cohort assignment is low stakes: an adversary gains
    ///      nothing from concentrating in one cohort (its wallets then get
    ///      compared against each other) nor from spreading across cohorts.
    function closeEnrollment() external atPhase(Phase.Enrolling) {
        if (block.timestamp < closesAt) revert EnrollmentWindowStillOpen();
        phase = Phase.Closed;
        cohortSeed = blockhash(block.number - 1);
        emit EnrollmentClosed(enrolledCount, cohortSeed);
    }

    function settle() external atPhase(Phase.Closed) {
        if (msg.sender != admin) revert Unauthorized();
        phase = Phase.Settled;
        emit Settled();
    }

    function setSlasher(address slasher_) external {
        if (msg.sender != admin) revert Unauthorized();
        if (slasher != address(0)) revert SlasherAlreadySet();
        if (slasher_ == address(0)) revert ZeroAddress();
        slasher = slasher_;
        emit SlasherSet(slasher_);
    }

    // ------------------------------------------------------------- participation

    function enroll() external payable atPhase(Phase.Enrolling) {
        if (block.timestamp >= closesAt) revert EnrollmentWindowOver();
        if (_bond[msg.sender] != 0) revert AlreadyEnrolled();
        if (msg.value != bondAmount) revert IncorrectBond(bondAmount, msg.value);

        _bond[msg.sender] = msg.value;
        enrolledCount += 1;

        emit Enrolled(msg.sender, msg.value);
    }

    /// @notice Withdraw the bond after settlement.
    function withdrawBond() external atPhase(Phase.Settled) {
        uint256 amount = _bond[msg.sender];
        if (amount == 0) revert NotEnrolled();
        if (_withdrawn[msg.sender]) revert AlreadyWithdrawn();

        // Checks, effects, then interaction.
        _withdrawn[msg.sender] = true;
        _bond[msg.sender] = 0;

        emit BondWithdrawn(msg.sender, amount);

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Forfeit part of a bond. Called by ClusterRegistry when a cluster
    ///         finding is upheld, or when a qualified identity is abandoned.
    /// @dev The remainder stays claimable by the participant: a confirmed finding
    ///      prices the behaviour, it does not confiscate everything. Exclusion is
    ///      never silent and an appeal path is mandatory, see ARCHITECTURE.md.
    function forfeit(address participant) external {
        if (msg.sender != slasher) revert Unauthorized();
        uint256 amount = _bond[participant];
        if (amount == 0) revert NotEnrolled();

        uint256 kept = (amount * abandonmentForfeitBps) / BPS_DENOMINATOR;
        _bond[participant] = amount - kept;
        forfeitPool += kept;

        emit BondForfeited(participant, kept, amount - kept);
    }

    function withdrawForfeitPool(address to) external atPhase(Phase.Settled) {
        if (msg.sender != admin) revert Unauthorized();
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = forfeitPool;
        forfeitPool = 0;

        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ----------------------------------------------------------------- views

    function isEnrolled(address participant) external view returns (bool) {
        return _bond[participant] != 0;
    }

    function bondOf(address participant) external view returns (uint256) {
        return _bond[participant];
    }

    function hasWithdrawn(address participant) external view returns (bool) {
        return _withdrawn[participant];
    }

    function enrollmentClosed() external view returns (bool) {
        return phase == Phase.Closed || phase == Phase.Settled;
    }
}
