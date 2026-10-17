// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Test doubles that let the Lottery tests control qualification, scores and
///      cluster findings directly, without driving the whole protocol.
contract MockEnrollment {
    uint256 public enrolledCount;
    mapping(address => bool) public isEnrolled;
    mapping(address => bool) public forfeited;
    uint256 public forfeitCalls;

    function setEnrolled(address who, bool value) external {
        isEnrolled[who] = value;
    }

    function setEnrolledCount(uint256 count) external {
        enrolledCount = count;
    }

    function forfeit(address who) external {
        forfeited[who] = true;
        forfeitCalls += 1;
    }
}

contract MockHeartbeatRegistry {
    mapping(address => bool) public isQualified;
    mapping(address => uint8) public participationScore;
    uint256 public windowEndBlock;
    uint8 public challengeCount = 10;

    function setQualified(address who, bool value, uint8 score) external {
        isQualified[who] = value;
        participationScore[who] = score;
    }

    function setWindowEndBlock(uint256 value) external {
        windowEndBlock = value;
    }
}

contract MockClusterRegistry {
    mapping(address => uint256) private _multiplier;

    function setMultiplier(address who, uint256 bps) external {
        _multiplier[who] = bps;
    }

    function weightMultiplierBps(address who) external view returns (uint256) {
        uint256 value = _multiplier[who];
        return value == 0 ? 10_000 : value;
    }
}
