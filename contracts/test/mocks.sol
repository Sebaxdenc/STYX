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

contract MockLottery {
    mapping(address => bool) public hasEntitlement;

    function setEntitlement(address who, bool value) external {
        hasEntitlement[who] = value;
    }
}

contract MockClusters {
    mapping(address => bool) public isFlagged;
    bool public hasFinding;

    function setFinding(bool value) external {
        hasFinding = value;
    }

    function setFlagged(address who, bool value) external {
        isFlagged[who] = value;
    }

    function weightMultiplierBps(address who) external view returns (uint256) {
        return isFlagged[who] && hasFinding ? 2500 : 10_000;
    }
}

/// @dev Accepts an entitlement but is a contract, to exercise the EOA custody
///      requirement that blocks atomic account sales.
contract ContractHolder {
    function claim(address registry, bytes32 nullifier) external payable {
        (bool ok, bytes memory data) = registry.call{value: msg.value}(
            abi.encodeWithSignature("claimTicket(bytes32)", nullifier)
        );
        if (!ok) {
            assembly {
                revert(add(data, 32), mload(data))
            }
        }
    }
}
