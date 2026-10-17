// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ClusterRegistry} from "../src/ClusterRegistry.sol";
import {Enrollment} from "../src/Enrollment.sol";
import {HeartbeatRegistry} from "../src/HeartbeatRegistry.sol";
import {Lottery} from "../src/Lottery.sol";
import {Params, ProtocolParams} from "../script/Params.sol";

/// @notice Guards protocol-params.json against drift and internal inconsistency.
///
/// The JSON is the single source of truth (invariant 0 in AGENTS.md), which only
/// helps if something fails loudly when a value there becomes incoherent. These
/// tests are that something.
contract ParamsTest is Test {
    ProtocolParams internal p;

    function setUp() public {
        p = Params.load(vm);
    }

    function test_paramsAreInternallyConsistent() public view {
        // The response window must fit inside a sub-window, otherwise a challenge
        // could spill into the next round.
        assertLt(
            p.responseWindowBlocks, p.subWindowBlocks, "response window must fit in sub-window"
        );

        // The bitmap in HeartbeatRegistry is uint16.
        assertLe(p.challengeCount, 16, "at most 16 rounds fit the bitmap");

        // Qualification and weighting must both be reachable.
        assertLe(p.minResponsesToQualify, p.challengeCount, "threshold must be reachable");
        assertLe(p.participationCap, p.challengeCount, "cap must be reachable");

        assertGt(p.bondWei, 0, "bond must be non-zero to price identities");
        assertLe(p.abandonmentForfeitBps, 10_000, "forfeit cannot exceed the bond");
    }

    /// @notice Catches the classic error: changing the window in seconds and
    ///         forgetting to change it in blocks, or vice versa.
    function test_windowInSecondsMatchesWindowInBlocks() public view {
        string memory json = vm.readFile("../protocol-params.json");
        uint256 windowSeconds = vm.parseJsonUint(json, ".qualification.windowSeconds");
        uint256 windowBlocks = vm.parseJsonUint(json, ".qualification.windowBlocks");
        uint256 blockTimeMs = vm.parseJsonUint(json, ".network.blockTimeMs");

        assertEq((windowSeconds * 1000) / blockTimeMs, windowBlocks, "seconds and blocks disagree");
    }

    /// @notice Sub-windows must tile the window exactly, with no remainder.
    function test_subWindowsTileTheWindowExactly() public view {
        string memory json = vm.readFile("../protocol-params.json");
        uint256 windowBlocks = vm.parseJsonUint(json, ".qualification.windowBlocks");

        assertEq(windowBlocks % p.challengeCount, 0, "window must divide evenly into rounds");
        assertEq(
            uint256(p.subWindowBlocks) * p.challengeCount, windowBlocks, "sub-windows must tile"
        );
    }

    /// @notice The response window is wide on purpose: a narrow one censors the
    ///         slower half of the human latency distribution, which is the signal
    ///         the detector needs. See ARCHITECTURE.md section 2.
    function test_responseWindowIsWideEnoughToAvoidCensoringHumans() public view {
        string memory json = vm.readFile("../protocol-params.json");
        uint256 blockTimeMs = vm.parseJsonUint(json, ".network.blockTimeMs");
        uint256 responseMs = uint256(p.responseWindowBlocks) * blockTimeMs;

        assertGe(responseMs, 5000, "under 5s truncates normal human reaction times");
    }

    /// @notice La escala de la demo (~200 participantes) debe ser coherente.
    /// @dev Las cohortes existen para repartir la carga de 100.000 respuestas en
    ///      10 s. A escala de demo no hacen falta, y una sola cohorte es ademas
    ///      mejor para detectar, porque todos reciben el mismo bloque de reto y
    ///      sus latencias son directamente comparables.
    function test_demoScaleIsCoherent() public view {
        assertGt(p.inventory, 0, "el inventario no puede ser cero");
        assertGt(p.roundLengthBlocks, 0);

        if (p.cohortCount == 1) {
            // Perfil de demo: una cohorte, umbral de cluster pequeno.
            string memory json = vm.readFile("../protocol-params.json");
            uint256 minClusterSize = vm.parseJsonUint(json, ".detection.minClusterSize");
            assertLe(minClusterSize, 20, "con una cohorte el umbral debe ser de escala demo");
        }
    }

    function test_fullDeploymentWiresSlasher() public {
        Enrollment enrollment =
            new Enrollment(p.bondWei, p.enrollmentWindowSeconds, p.abandonmentForfeitBps);
        HeartbeatRegistry registry = new HeartbeatRegistry(
            address(enrollment),
            p.cohortCount,
            p.challengeCount,
            p.subWindowBlocks,
            p.responseWindowBlocks,
            p.minResponsesToQualify
        );
        ClusterRegistry clusters = new ClusterRegistry(
            address(enrollment), address(0xBEEF), p.appealBondWei, p.disputeWindowSeconds
        );
        Lottery lottery = new Lottery(
            address(enrollment),
            address(registry),
            address(clusters),
            p.inventory,
            p.participationCap,
            p.roundLengthBlocks
        );
        enrollment.setSlasher(address(clusters));

        // Solo ClusterRegistry puede penalizar bonos.
        assertEq(enrollment.slasher(), address(clusters));
        assertEq(lottery.inventory(), p.inventory);
        assertEq(lottery.participationCap(), p.participationCap);
        assertEq(address(lottery.clusters()), address(clusters));
    }

    function test_paramsProduceDeployableContracts() public {
        Enrollment enrollment =
            new Enrollment(p.bondWei, p.enrollmentWindowSeconds, p.abandonmentForfeitBps);

        HeartbeatRegistry registry = new HeartbeatRegistry(
            address(enrollment),
            p.cohortCount,
            p.challengeCount,
            p.subWindowBlocks,
            p.responseWindowBlocks,
            p.minResponsesToQualify
        );

        assertEq(enrollment.bondAmount(), p.bondWei);
        assertEq(enrollment.enrollmentWindowSeconds(), p.enrollmentWindowSeconds);
        assertEq(enrollment.abandonmentForfeitBps(), p.abandonmentForfeitBps);

        assertEq(registry.cohortCount(), p.cohortCount);
        assertEq(registry.challengeCount(), p.challengeCount);
        assertEq(registry.subWindowBlocks(), p.subWindowBlocks);
        assertEq(registry.responseWindowBlocks(), p.responseWindowBlocks);
        assertEq(registry.minResponsesToQualify(), p.minResponsesToQualify);
    }
}
