// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Enrollment} from "../src/Enrollment.sol";
import {HeartbeatRegistry} from "../src/HeartbeatRegistry.sol";
import {Params, ProtocolParams} from "./Params.sol";

/// @notice Deploys STYX using the parameters in protocol-params.json.
/// @dev Parameters are never hardcoded here. See invariant 0 in AGENTS.md.
contract Deploy is Script {
    function run() external returns (Enrollment enrollment, HeartbeatRegistry registry) {
        ProtocolParams memory p = Params.load(vm);

        vm.startBroadcast();

        enrollment = new Enrollment(p.bondWei, p.enrollmentWindowSeconds, p.abandonmentForfeitBps);

        registry = new HeartbeatRegistry(
            address(enrollment),
            p.cohortCount,
            p.challengeCount,
            p.subWindowBlocks,
            p.responseWindowBlocks,
            p.minResponsesToQualify
        );

        vm.stopBroadcast();

        console.log("Enrollment       ", address(enrollment));
        console.log("HeartbeatRegistry", address(registry));
        console.log("cohorts          ", p.cohortCount);
        console.log("challenges       ", p.challengeCount);
        console.log("subWindowBlocks  ", p.subWindowBlocks);
        console.log("responseWindow   ", p.responseWindowBlocks);
    }
}
