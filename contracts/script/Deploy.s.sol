// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ClusterRegistry} from "../src/ClusterRegistry.sol";
import {Enrollment} from "../src/Enrollment.sol";
import {HeartbeatRegistry} from "../src/HeartbeatRegistry.sol";
import {Lottery} from "../src/Lottery.sol";
import {Params, ProtocolParams} from "./Params.sol";

/// @notice Deploys STYX using the parameters in protocol-params.json.
/// @dev Parameters are never hardcoded here. See invariant 0 in AGENTS.md.
contract Deploy is Script {
    function run()
        external
        returns (
            Enrollment enrollment,
            HeartbeatRegistry registry,
            ClusterRegistry clusters,
            Lottery lottery
        )
    {
        ProtocolParams memory p = Params.load(vm);

        // The resolver adjudicates appeals and is the single trusted component in
        // ClusterRegistry, documented as a known limitation. Override it in a real
        // deployment; it must not be the deployer.
        address resolver = vm.envOr("STYX_RESOLVER", msg.sender);

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

        clusters = new ClusterRegistry(
            address(enrollment), resolver, p.appealBondWei, p.disputeWindowSeconds
        );

        lottery = new Lottery(
            address(enrollment),
            address(registry),
            address(clusters),
            p.inventory,
            p.participationCap,
            p.roundLengthBlocks
        );

        // ClusterRegistry is the only contract allowed to forfeit bonds.
        enrollment.setSlasher(address(clusters));

        vm.stopBroadcast();

        console.log("Enrollment       ", address(enrollment));
        console.log("HeartbeatRegistry", address(registry));
        console.log("ClusterRegistry  ", address(clusters));
        console.log("Lottery          ", address(lottery));
        console.log("resolver         ", resolver);
        console.log("inventory        ", p.inventory);
        console.log("cohorts          ", p.cohortCount);
        console.log("challenges       ", p.challengeCount);

        if (resolver == msg.sender) {
            console.log("AVISO: resolver == deployer. Usa STYX_RESOLVER en produccion.");
        }
    }
}
