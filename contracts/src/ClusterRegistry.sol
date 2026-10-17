// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IEnrollmentSlashing} from "./interfaces.sol";

/// @title ClusterRegistry
/// @notice Commitment and dispute layer for coordination findings.
///
/// The detector runs off chain and only its RESULT lands here: a Merkle root over
/// (wallet, clusterId) pairs, plus the CIDs of the ruleset and the dataset it
/// used. That is the opML pattern, inference off chain with optimistic
/// verification on chain.
///
/// Three properties are deliberate:
///
/// 1. A finding REDUCES lottery weight. It never zeroes it and never excludes
///    silently, and the appeal path is mandatory. Invariant 3.
/// 2. Marking a wallet is PERMISSIONLESS. Anyone can submit a Merkle proof, so
///    enforcement does not depend on the operator bothering. Participants who did
///    not win have an incentive to do it.
/// 3. The ruleset and dataset CIDs are committed BEFORE enforcement, so anyone
///    can recompute the finding and refute it. Reproducibility is what makes the
///    dispute game meaningful.
///
/// # Known trust assumption
///
/// Adjudicating a statistical claim needs an arbiter, which is why protocols like
/// Kleros exist. `resolver` is therefore the one trusted component in this
/// contract and it conflicts with invariant 6. It is immutable, its decisions are
/// public and bonded, and it cannot commit findings itself. Production should
/// replace it with a decentralised arbitration protocol. This is recorded as a
/// limitation rather than hidden.
contract ClusterRegistry {
    /// @notice Weight kept by a wallet under an upheld finding, in basis points.
    /// @dev Non-zero on purpose: a finding prices the behaviour, it does not
    ///      confiscate participation. Invariant 3.
    uint256 public constant FLAGGED_MULTIPLIER_BPS = 2500;
    uint256 public constant CLEAN_MULTIPLIER_BPS = 10_000;

    enum AppealState {
        None,
        Pending,
        Upheld,
        Rejected
    }

    error Unauthorized();
    error FindingAlreadyCommitted();
    error NoFinding();
    error FindingVoided();
    error InvalidProof();
    error AlreadyFlagged();
    error NotFlagged();
    error DisputeWindowOver();
    error DisputeWindowOpen();
    error AppealAlreadyRaised();
    error NoAppealPending();
    error IncorrectBond(uint256 expected, uint256 provided);
    error EmptyCid();
    error ZeroAddress();
    error TransferFailed();

    event FindingCommitted(
        bytes32 root, string rulesetCid, string datasetCid, address submitter, uint256 closesAt
    );
    event FindingVoid(string reason);
    event WalletFlagged(address indexed wallet, uint256 clusterId, address marker);
    event AppealRaised(address indexed wallet, uint256 bond);
    event AppealResolved(address indexed wallet, bool upheld);
    event BondForfeitRequested(address indexed wallet);

    address public immutable admin;
    address public immutable resolver;
    IEnrollmentSlashing public immutable enrollment;
    uint256 public immutable appealBond;
    uint256 public immutable disputeWindowSeconds;

    bytes32 public root;
    string public rulesetCid;
    string public datasetCid;
    address public submitter;
    uint256 public disputeClosesAt;
    bool public voided;

    mapping(address => bool) public isFlagged;
    mapping(address => uint256) public clusterOf;
    mapping(address => AppealState) public appealState;
    mapping(address => uint256) private _appealBond;

    constructor(
        address enrollment_,
        address resolver_,
        uint256 appealBond_,
        uint256 disputeWindowSeconds_
    ) {
        if (enrollment_ == address(0) || resolver_ == address(0)) {
            revert ZeroAddress();
        }
        admin = msg.sender;
        enrollment = IEnrollmentSlashing(enrollment_);
        resolver = resolver_;
        appealBond = appealBond_;
        disputeWindowSeconds = disputeWindowSeconds_;
    }

    // --------------------------------------------------------------- finding

    /// @notice Commit a detector result.
    /// @dev Committed once. The root cannot be replaced, only voided, so a
    ///      finding cannot be quietly swapped after wallets were marked.
    function commitFinding(bytes32 root_, string calldata rulesetCid_, string calldata datasetCid_)
        external
    {
        if (msg.sender != admin) revert Unauthorized();
        if (root != bytes32(0)) revert FindingAlreadyCommitted();
        if (bytes(rulesetCid_).length == 0 || bytes(datasetCid_).length == 0) revert EmptyCid();

        root = root_;
        rulesetCid = rulesetCid_;
        datasetCid = datasetCid_;
        submitter = msg.sender;
        disputeClosesAt = block.timestamp + disputeWindowSeconds;

        emit FindingCommitted(root_, rulesetCid_, datasetCid_, msg.sender, disputeClosesAt);
    }

    /// @notice Void the whole finding, for instance when the ruleset is shown to
    ///         be wrong rather than one wallet being misclassified.
    /// @dev Clears nothing per wallet: `weightMultiplierBps` reads `voided` and
    ///      returns every wallet to full weight, which is cheaper and leaves the
    ///      audit trail intact.
    function voidFinding(string calldata reason) external {
        if (msg.sender != resolver) revert Unauthorized();
        if (root == bytes32(0)) revert NoFinding();
        voided = true;
        emit FindingVoid(reason);
    }

    // --------------------------------------------------------------- marking

    /// @notice Mark a wallet as belonging to a committed cluster.
    /// @dev Permissionless and verifiable: the proof is checked against the
    ///      committed root, so a marker cannot invent a membership. Enforcement
    ///      therefore does not depend on the operator acting.
    function markFlagged(address wallet, uint256 clusterId, bytes32[] calldata proof) external {
        if (root == bytes32(0)) revert NoFinding();
        if (voided) revert FindingVoided();
        if (isFlagged[wallet]) revert AlreadyFlagged();
        if (block.timestamp > disputeClosesAt) revert DisputeWindowOver();

        bytes32 leaf = keccak256(abi.encodePacked(wallet, clusterId));
        if (!_verify(proof, leaf)) revert InvalidProof();

        isFlagged[wallet] = true;
        clusterOf[wallet] = clusterId;

        emit WalletFlagged(wallet, clusterId, msg.sender);
    }

    // ---------------------------------------------------------------- appeal

    /// @notice Appeal a marking. Mandatory path, per invariant 3.
    function appeal() external payable {
        if (!isFlagged[msg.sender]) revert NotFlagged();
        if (appealState[msg.sender] != AppealState.None) revert AppealAlreadyRaised();
        if (msg.value != appealBond) revert IncorrectBond(appealBond, msg.value);

        appealState[msg.sender] = AppealState.Pending;
        _appealBond[msg.sender] = msg.value;

        emit AppealRaised(msg.sender, msg.value);
    }

    /// @notice Resolve an appeal. `upheld` true means the participant wins and
    ///         the marking is lifted.
    function resolveAppeal(address wallet, bool upheld) external {
        if (msg.sender != resolver) revert Unauthorized();
        if (appealState[wallet] != AppealState.Pending) revert NoAppealPending();

        uint256 bond = _appealBond[wallet];
        _appealBond[wallet] = 0;

        if (upheld) {
            appealState[wallet] = AppealState.Upheld;
            isFlagged[wallet] = false;
            emit AppealResolved(wallet, true);

            // The appellant was right, so the bond comes back.
            if (bond > 0) {
                (bool ok,) = wallet.call{value: bond}("");
                if (!ok) revert TransferFailed();
            }
        } else {
            appealState[wallet] = AppealState.Rejected;
            emit AppealResolved(wallet, false);
        }
    }

    // -------------------------------------------------------------- slashing

    /// @notice Request the bond forfeit of a wallet whose finding stands.
    /// @dev Only after the dispute window closed and only if no appeal was
    ///      upheld. Permissionless, for the same reason marking is.
    function requestForfeit(address wallet) external {
        if (root == bytes32(0)) revert NoFinding();
        if (voided) revert FindingVoided();
        if (block.timestamp <= disputeClosesAt) revert DisputeWindowOpen();
        if (!isFlagged[wallet]) revert NotFlagged();
        if (appealState[wallet] == AppealState.Pending) revert NoAppealPending();

        emit BondForfeitRequested(wallet);
        enrollment.forfeit(wallet);
    }

    // ----------------------------------------------------------------- views

    /// @notice Weight multiplier consumed by `Lottery`.
    /// @dev Reduces, never zeroes. A flagged participant keeps a real chance, so
    ///      a false positive costs opportunity rather than access, which is the
    ///      whole reason findings modulate instead of excluding.
    function weightMultiplierBps(address participant) external view returns (uint256) {
        if (voided || root == bytes32(0)) return CLEAN_MULTIPLIER_BPS;
        if (!isFlagged[participant]) return CLEAN_MULTIPLIER_BPS;
        if (appealState[participant] == AppealState.Upheld) return CLEAN_MULTIPLIER_BPS;
        return FLAGGED_MULTIPLIER_BPS;
    }

    function hasFinding() external view returns (bool) {
        return root != bytes32(0) && !voided;
    }

    function disputeWindowOpen() external view returns (bool) {
        return root != bytes32(0) && block.timestamp <= disputeClosesAt;
    }

    /// @dev Sorted-pair Merkle verification, matching OpenZeppelin's MerkleProof
    ///      and the detector's Python implementation. There is a reference vector
    ///      test on both sides: if they diverge, the on-chain commitment stops
    ///      being verifiable.
    function _verify(bytes32[] calldata proof, bytes32 leaf) internal view returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];
            computed = computed <= sibling
                ? keccak256(abi.encodePacked(computed, sibling))
                : keccak256(abi.encodePacked(sibling, computed));
        }
        return computed == root;
    }

    receive() external payable {}
}
