// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Read surface of HeartbeatRegistry consumed by Lottery.
interface IHeartbeatRegistry {
    function isQualified(address participant) external view returns (bool);
    function participationScore(address participant) external view returns (uint8);
    function windowEndBlock() external view returns (uint256);
    function challengeCount() external view returns (uint8);
}

/// @notice Read surface of Enrollment consumed by Lottery.
interface IEnrollmentView {
    function isEnrolled(address participant) external view returns (bool);
    function enrolledCount() external view returns (uint256);
}

/// @notice Write surface of Enrollment consumed by ClusterRegistry.
interface IEnrollmentSlashing {
    function forfeit(address participant) external;
}

/// @notice Read surface of ClusterRegistry consumed by Lottery and TicketRegistry.
interface IClusterRegistry {
    /// @return Weight multiplier in basis points. 10000 means untouched.
    ///         A cluster finding REDUCES weight, it never zeroes it: exclusion is
    ///         never silent and an appeal path is mandatory. See invariant 3.
    function weightMultiplierBps(address participant) external view returns (uint256);
    function isFlagged(address participant) external view returns (bool);
    function hasFinding() external view returns (bool);
}

/// @notice Read surface of Lottery consumed by TicketRegistry.
interface ILottery {
    function hasEntitlement(address participant) external view returns (bool);
}

/// @notice Pluggable identity check used at the gate.
///
/// In production this verifies a zero-knowledge proof that the bearer holds the
/// document whose nullifier was bound at claim, over a challenge issued at the
/// gate so a proof cannot be replayed. Only the nullifier is ever stored, so no
/// personal data touches the chain.
interface IIdentityVerifier {
    function verify(bytes32 nullifier, bytes32 gateChallenge, bytes calldata proof)
        external
        view
        returns (bool);
}
