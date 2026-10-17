// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Read interface consumed by HeartbeatRegistry.
interface IEnrollment {
    /// @return True once the participant has posted a bond.
    function isEnrolled(address participant) external view returns (bool);

    /// @return Seed fixed when enrolment closed, used to derive cohorts.
    ///         Zero while enrolment is still open.
    function cohortSeed() external view returns (bytes32);
}
