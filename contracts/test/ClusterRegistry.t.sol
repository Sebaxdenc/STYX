// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ClusterRegistry} from "../src/ClusterRegistry.sol";
import {MockEnrollment} from "./mocks.sol";

contract ClusterRegistryTest is Test {
    MockEnrollment internal enr;
    ClusterRegistry internal reg;

    uint256 internal constant APPEAL_BOND = 1 ether;
    uint256 internal constant DISPUTE_WINDOW = 172_800;

    address internal resolver = makeAddr("resolver");
    address internal marker = makeAddr("marker");

    // Arbol de cuatro hojas, con pares ordenados igual que OpenZeppelin y que la
    // implementacion en Python del detector.
    address internal walletA = address(uint160(0xA1));
    address internal walletB = address(uint160(0xB2));
    address internal walletC = address(uint160(0xC3));
    address internal walletD = address(uint160(0xD4));

    bytes32[4] internal leaves;
    bytes32 internal root;

    function setUp() public {
        enr = new MockEnrollment();
        reg = new ClusterRegistry(address(enr), resolver, APPEAL_BOND, DISPUTE_WINDOW);

        leaves[0] = _leaf(walletA, 0);
        leaves[1] = _leaf(walletB, 0);
        leaves[2] = _leaf(walletC, 1);
        leaves[3] = _leaf(walletD, 1);
        _sortLeaves();

        bytes32 left = _hashPair(leaves[0], leaves[1]);
        bytes32 right = _hashPair(leaves[2], leaves[3]);
        root = _hashPair(left, right);
    }

    function _leaf(address wallet, uint256 clusterId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(wallet, clusterId));
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a <= b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _sortLeaves() internal {
        for (uint256 i = 0; i < 4; i++) {
            for (uint256 j = i + 1; j < 4; j++) {
                if (leaves[j] < leaves[i]) {
                    bytes32 tmp = leaves[i];
                    leaves[i] = leaves[j];
                    leaves[j] = tmp;
                }
            }
        }
    }

    /// @dev Prueba de la hoja en la posicion `index` del arbol de cuatro hojas.
    function _proofFor(uint256 index) internal view returns (bytes32[] memory proof) {
        proof = new bytes32[](2);
        if (index < 2) {
            proof[0] = leaves[index == 0 ? 1 : 0];
            proof[1] = _hashPair(leaves[2], leaves[3]);
        } else {
            proof[0] = leaves[index == 2 ? 3 : 2];
            proof[1] = _hashPair(leaves[0], leaves[1]);
        }
    }

    /// @dev Devuelve (wallet, clusterId) de la hoja en `index`.
    function _ownerOfLeaf(uint256 index) internal view returns (address, uint256) {
        bytes32 target = leaves[index];
        if (target == _leaf(walletA, 0)) return (walletA, 0);
        if (target == _leaf(walletB, 0)) return (walletB, 0);
        if (target == _leaf(walletC, 1)) return (walletC, 1);
        return (walletD, 1);
    }

    function _commit() internal {
        reg.commitFinding(root, "ipfs://ruleset", "ipfs://dataset");
    }

    // ------------------------------------------------------------ happy path

    function test_commitFinding_storesRootAndCids() public {
        _commit();

        assertEq(reg.root(), root);
        assertEq(reg.rulesetCid(), "ipfs://ruleset");
        assertEq(reg.datasetCid(), "ipfs://dataset");
        assertTrue(reg.hasFinding());
        assertTrue(reg.disputeWindowOpen());
    }

    function test_markFlagged_isPermissionless() public {
        _commit();
        (address wallet, uint256 clusterId) = _ownerOfLeaf(0);

        // Un tercero cualquiera puede marcar: la aplicacion no depende del
        // operador, y la prueba se verifica contra la raiz comprometida.
        vm.prank(marker);
        reg.markFlagged(wallet, clusterId, _proofFor(0));

        assertTrue(reg.isFlagged(wallet));
        assertEq(reg.clusterOf(wallet), clusterId);
    }

    function test_flaggedWalletKeepsPartialWeight() public {
        _commit();
        (address wallet, uint256 clusterId) = _ownerOfLeaf(0);
        vm.prank(marker);
        reg.markFlagged(wallet, clusterId, _proofFor(0));

        uint256 multiplier = reg.weightMultiplierBps(wallet);
        assertEq(multiplier, reg.FLAGGED_MULTIPLIER_BPS());
        assertGt(multiplier, 0, "invariante 3: reduce, nunca excluye");
        assertLt(multiplier, reg.CLEAN_MULTIPLIER_BPS());
    }

    function test_unflaggedWalletHasFullWeight() public {
        _commit();
        assertEq(reg.weightMultiplierBps(makeAddr("inocente")), reg.CLEAN_MULTIPLIER_BPS());
    }

    function test_noFindingMeansFullWeightForEveryone() public view {
        assertEq(reg.weightMultiplierBps(walletA), reg.CLEAN_MULTIPLIER_BPS());
    }

    // ----------------------------------------------------------------- appeal

    function test_appeal_upheldRestoresFullWeightAndReturnsBond() public {
        _commit();
        (address wallet, uint256 clusterId) = _ownerOfLeaf(0);
        vm.prank(marker);
        reg.markFlagged(wallet, clusterId, _proofFor(0));

        vm.deal(wallet, APPEAL_BOND);
        vm.prank(wallet);
        reg.appeal{value: APPEAL_BOND}();
        assertEq(uint8(reg.appealState(wallet)), uint8(ClusterRegistry.AppealState.Pending));

        uint256 before = wallet.balance;
        vm.prank(resolver);
        reg.resolveAppeal(wallet, true);

        assertFalse(reg.isFlagged(wallet));
        assertEq(reg.weightMultiplierBps(wallet), reg.CLEAN_MULTIPLIER_BPS());
        assertEq(wallet.balance - before, APPEAL_BOND, "el apelante tenia razon");
    }

    function test_appeal_rejectedKeepsTheFlagAndTheBond() public {
        _commit();
        (address wallet, uint256 clusterId) = _ownerOfLeaf(0);
        vm.prank(marker);
        reg.markFlagged(wallet, clusterId, _proofFor(0));

        vm.deal(wallet, APPEAL_BOND);
        vm.prank(wallet);
        reg.appeal{value: APPEAL_BOND}();

        vm.prank(resolver);
        reg.resolveAppeal(wallet, false);

        assertTrue(reg.isFlagged(wallet));
        assertEq(reg.weightMultiplierBps(wallet), reg.FLAGGED_MULTIPLIER_BPS());
        assertEq(address(reg).balance, APPEAL_BOND);
    }

    function test_appeal_revertsForUnflagged() public {
        _commit();
        address clean = makeAddr("limpio");
        vm.deal(clean, APPEAL_BOND);
        vm.prank(clean);
        vm.expectRevert(ClusterRegistry.NotFlagged.selector);
        reg.appeal{value: APPEAL_BOND}();
    }

    function test_appeal_revertsOnWrongBond() public {
        _commit();
        (address wallet, uint256 clusterId) = _ownerOfLeaf(0);
        vm.prank(marker);
        reg.markFlagged(wallet, clusterId, _proofFor(0));

        vm.deal(wallet, 10 ether);
        vm.prank(wallet);
        vm.expectRevert(
            abi.encodeWithSelector(ClusterRegistry.IncorrectBond.selector, APPEAL_BOND, 1 wei)
        );
        reg.appeal{value: 1 wei}();
    }

    function test_resolveAppeal_onlyResolver() public {
        _commit();
        (address wallet, uint256 clusterId) = _ownerOfLeaf(0);
        vm.prank(marker);
        reg.markFlagged(wallet, clusterId, _proofFor(0));
        vm.deal(wallet, APPEAL_BOND);
        vm.prank(wallet);
        reg.appeal{value: APPEAL_BOND}();

        vm.prank(marker);
        vm.expectRevert(ClusterRegistry.Unauthorized.selector);
        reg.resolveAppeal(wallet, true);
    }

    // --------------------------------------------------------------- reverts

    function test_markFlagged_rejectsInvalidProof() public {
        _commit();
        bytes32[] memory bad = new bytes32[](2);
        bad[0] = keccak256("basura");
        bad[1] = keccak256("mas basura");

        vm.expectRevert(ClusterRegistry.InvalidProof.selector);
        reg.markFlagged(walletA, 0, bad);
    }

    function test_markFlagged_rejectsWrongClusterId() public {
        _commit();
        // Prueba valida, pero con el clusterId cambiado: la hoja ya no cuadra.
        (address wallet,) = _ownerOfLeaf(0);
        vm.expectRevert(ClusterRegistry.InvalidProof.selector);
        reg.markFlagged(wallet, 999, _proofFor(0));
    }

    function test_markFlagged_revertsWithoutFinding() public {
        vm.expectRevert(ClusterRegistry.NoFinding.selector);
        reg.markFlagged(walletA, 0, _proofFor(0));
    }

    function test_markFlagged_revertsAfterDisputeWindow() public {
        _commit();
        (address wallet, uint256 clusterId) = _ownerOfLeaf(0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.expectRevert(ClusterRegistry.DisputeWindowOver.selector);
        reg.markFlagged(wallet, clusterId, _proofFor(0));
    }

    function test_markFlagged_revertsTwice() public {
        _commit();
        (address wallet, uint256 clusterId) = _ownerOfLeaf(0);
        reg.markFlagged(wallet, clusterId, _proofFor(0));

        vm.expectRevert(ClusterRegistry.AlreadyFlagged.selector);
        reg.markFlagged(wallet, clusterId, _proofFor(0));
    }

    function test_commitFinding_onlyOnce() public {
        _commit();
        vm.expectRevert(ClusterRegistry.FindingAlreadyCommitted.selector);
        _commit();
    }

    function test_commitFinding_requiresCids() public {
        vm.expectRevert(ClusterRegistry.EmptyCid.selector);
        reg.commitFinding(root, "", "ipfs://dataset");
    }

    function test_commitFinding_onlyAdmin() public {
        vm.prank(marker);
        vm.expectRevert(ClusterRegistry.Unauthorized.selector);
        reg.commitFinding(root, "a", "b");
    }

    // -------------------------------------------------------------- voiding

    function test_voidFinding_restoresEveryoneToFullWeight() public {
        _commit();
        (address wallet, uint256 clusterId) = _ownerOfLeaf(0);
        reg.markFlagged(wallet, clusterId, _proofFor(0));

        vm.prank(resolver);
        reg.voidFinding("el ruleset era incorrecto");

        assertEq(reg.weightMultiplierBps(wallet), reg.CLEAN_MULTIPLIER_BPS());
        assertFalse(reg.hasFinding());
    }

    function test_voidFinding_onlyResolver() public {
        _commit();
        vm.expectRevert(ClusterRegistry.Unauthorized.selector);
        reg.voidFinding("intento");
    }

    // -------------------------------------------------------------- slashing

    function test_requestForfeit_afterWindowAndIsPermissionless() public {
        _commit();
        (address wallet, uint256 clusterId) = _ownerOfLeaf(0);
        reg.markFlagged(wallet, clusterId, _proofFor(0));
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.prank(marker);
        reg.requestForfeit(wallet);

        assertTrue(enr.forfeited(wallet));
        assertEq(enr.forfeitCalls(), 1);
    }

    function test_requestForfeit_revertsWhileWindowOpen() public {
        _commit();
        (address wallet, uint256 clusterId) = _ownerOfLeaf(0);
        reg.markFlagged(wallet, clusterId, _proofFor(0));

        vm.expectRevert(ClusterRegistry.DisputeWindowOpen.selector);
        reg.requestForfeit(wallet);
    }

    function test_requestForfeit_revertsWithAppealPending() public {
        _commit();
        (address wallet, uint256 clusterId) = _ownerOfLeaf(0);
        reg.markFlagged(wallet, clusterId, _proofFor(0));
        vm.deal(wallet, APPEAL_BOND);
        vm.prank(wallet);
        reg.appeal{value: APPEAL_BOND}();
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.expectRevert(ClusterRegistry.NoAppealPending.selector);
        reg.requestForfeit(wallet);
    }

    function test_requestForfeit_revertsAfterUpheldAppeal() public {
        _commit();
        (address wallet, uint256 clusterId) = _ownerOfLeaf(0);
        reg.markFlagged(wallet, clusterId, _proofFor(0));
        vm.deal(wallet, APPEAL_BOND);
        vm.prank(wallet);
        reg.appeal{value: APPEAL_BOND}();
        vm.prank(resolver);
        reg.resolveAppeal(wallet, true);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.expectRevert(ClusterRegistry.NotFlagged.selector);
        reg.requestForfeit(wallet);
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzz_onlyCommittedLeavesCanBeFlagged(address wallet, uint256 clusterId) public {
        _commit();
        vm.assume(
            _leaf(wallet, clusterId) != leaves[0] && _leaf(wallet, clusterId) != leaves[1]
                && _leaf(wallet, clusterId) != leaves[2] && _leaf(wallet, clusterId) != leaves[3]
        );

        vm.expectRevert(ClusterRegistry.InvalidProof.selector);
        reg.markFlagged(wallet, clusterId, _proofFor(0));
    }

    function testFuzz_multiplierIsAlwaysBetweenFlaggedAndClean(address wallet) public {
        _commit();
        uint256 multiplier = reg.weightMultiplierBps(wallet);
        assertGe(multiplier, reg.FLAGGED_MULTIPLIER_BPS());
        assertLe(multiplier, reg.CLEAN_MULTIPLIER_BPS());
    }
}
