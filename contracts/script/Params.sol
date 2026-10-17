// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";

struct ProtocolParams {
    uint256 bondWei;
    uint256 enrollmentWindowSeconds;
    uint256 abandonmentForfeitBps;
    uint16 cohortCount;
    uint8 challengeCount;
    uint32 subWindowBlocks;
    uint32 responseWindowBlocks;
    uint8 minResponsesToQualify;
    uint8 participationCap;
    uint256 inventory;
    uint256 priceWei;
    uint256 roundLengthBlocks;
    uint256 appealBondWei;
    uint256 disputeWindowSeconds;
    uint256 qualificationWindowSeconds;
}

/// @notice Loads protocol-params.json, the single source of truth for parameters.
/// @dev Shared by the deploy script and by the test that guards against drift
///      between the JSON and what the contracts are actually configured with.
library Params {
    string internal constant PATH = "../protocol-params.json";

    function load(Vm vm) internal view returns (ProtocolParams memory p) {
        string memory json = vm.readFile(PATH);

        // bondWei is quoted in the JSON so no precision is lost on large values.
        p.bondWei = vm.parseUint(vm.parseJsonString(json, ".enrollment.bondWei"));
        p.enrollmentWindowSeconds = vm.parseJsonUint(json, ".enrollment.windowSeconds");
        p.abandonmentForfeitBps = vm.parseJsonUint(json, ".enrollment.abandonmentForfeitBps");

        p.cohortCount = uint16(vm.parseJsonUint(json, ".qualification.cohortCount"));
        p.challengeCount = uint8(vm.parseJsonUint(json, ".qualification.challengeCount"));
        p.responseWindowBlocks =
            uint32(vm.parseJsonUint(json, ".qualification.responseWindowBlocks"));
        p.minResponsesToQualify =
            uint8(vm.parseJsonUint(json, ".qualification.minResponsesToQualify"));
        p.participationCap = uint8(vm.parseJsonUint(json, ".lottery.participationCap"));

        p.inventory = vm.parseJsonUint(json, ".sale.inventory");
        p.priceWei = vm.parseUint(vm.parseJsonString(json, ".sale.priceWei"));
        p.qualificationWindowSeconds = vm.parseJsonUint(json, ".qualification.windowSeconds");
        p.roundLengthBlocks = vm.parseJsonUint(json, ".lottery.roundLengthBlocks");
        p.appealBondWei = vm.parseUint(vm.parseJsonString(json, ".dispute.challengerBondWei"));
        p.disputeWindowSeconds = vm.parseJsonUint(json, ".dispute.windowSeconds");

        // Derived rather than stored, so the two values cannot drift apart.
        uint256 windowBlocks = vm.parseJsonUint(json, ".qualification.windowBlocks");
        p.subWindowBlocks = uint32(windowBlocks / p.challengeCount);
    }
}
