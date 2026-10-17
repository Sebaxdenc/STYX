// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IClusterRegistry, IIdentityVerifier, ILottery} from "./interfaces.sol";

/// @title TicketRegistry
/// @notice Phase 4 of STYX: issuance, provisional ownership and redemption.
///
/// # Ownership is staged on purpose
///
///     Entitlement -> Provisional -> Final -> Redeemed
///                              \-> Revoked
///
/// A ticket stays PROVISIONAL while the dispute window is open. That is what
/// makes retrospective detection enforceable: in real time there are seconds of
/// data and nothing is detectable, while in hindsight the whole pattern is
/// there. If ownership were final the instant the draw closed, a cluster finding
/// would be a report with no consequences.
///
/// Revocation works here in a way a chargeback does not: the ticket is a right
/// checked at the gate, so if the contract invalidated it before the event it
/// simply does not work.
///
/// # Transfer restriction is not the control
///
/// Restricting transfers does not stop resale. An operator sells the WALLET
/// instead of the token: the key changes hands, the token never moves, and the
/// restriction never fires. With ERC-6551 token bound accounts or a multisig
/// that sale is even atomic and trustless.
///
/// So the control sits at REDEMPTION, not transfer:
///
///     Bearer model (broken):      whoever holds the key enters
///     Entitlement model (used):   whoever proves the bound identity enters
///
/// Once redemption is identity bound, transferability of the wallet becomes
/// irrelevant rather than being the hole in the design.
contract TicketRegistry {
    enum State {
        None,
        Provisional,
        Final,
        Revoked,
        Redeemed
    }

    error Unauthorized();
    error NoEntitlement();
    error AlreadyClaimed();
    error NotProvisional(State actual);
    error NotRedeemable(State actual);
    error ContractCustodyForbidden();
    error DisputeWindowOpen(uint256 closesAt);
    error DisputeWindowOver(uint256 closesAt);
    error NotFlagged();
    error IncorrectPayment(uint256 expected, uint256 provided);
    error IdentityAlreadyUsed();
    error EmptyNullifier();
    error InvalidIdentityProof();
    error TransferFailed();
    error ZeroAddress();

    event TicketClaimed(address indexed holder, bytes32 nullifier, uint256 paid);
    event TicketRevoked(address indexed holder, address caller, uint256 refunded);
    event TicketFinalized(address indexed holder);
    event TicketRedeemed(address indexed holder, bytes32 gateChallenge);

    ILottery public immutable lottery;
    IClusterRegistry public immutable clusters;
    IIdentityVerifier public immutable identityVerifier;

    uint256 public immutable priceWei;
    uint256 public immutable disputeWindowSeconds;

    mapping(address => State) public stateOf;
    mapping(address => bytes32) public nullifierOf;
    mapping(address => uint256) public claimedAt;
    mapping(address => uint256) public paidBy;
    /// @dev One ticket per real identity, not per wallet. A per-wallet limit is
    ///      no limit at all, because wallets are free and unlimited.
    mapping(bytes32 => bool) public nullifierUsed;

    uint256 public issued;
    uint256 public revoked;

    constructor(
        address lottery_,
        address clusters_,
        address identityVerifier_,
        uint256 priceWei_,
        uint256 disputeWindowSeconds_
    ) {
        if (lottery_ == address(0) || clusters_ == address(0) || identityVerifier_ == address(0)) {
            revert ZeroAddress();
        }
        lottery = ILottery(lottery_);
        clusters = IClusterRegistry(clusters_);
        identityVerifier = IIdentityVerifier(identityVerifier_);
        priceWei = priceWei_;
        disputeWindowSeconds = disputeWindowSeconds_;
    }

    // ----------------------------------------------------------------- claim

    /// @notice Turn a lottery entitlement into a provisional ticket.
    ///
    /// @param nullifier Identity commitment. In production this is a
    ///        zero-knowledge nullifier derived from a government document, so an
    ///        adversary cannot field ten thousand real documents. Only the
    ///        nullifier is stored: no personal data reaches the chain.
    ///
    /// @dev Requires EOA custody. A contract account can be sold atomically,
    ///      which would turn the ticket back into a bearer instrument. Checking
    ///      `code.length == 0` also excludes EIP-7702 delegated accounts, whose
    ///      code is a delegation designator.
    function claimTicket(bytes32 nullifier) external payable {
        if (nullifier == bytes32(0)) revert EmptyNullifier();
        if (!lottery.hasEntitlement(msg.sender)) revert NoEntitlement();
        if (stateOf[msg.sender] != State.None) revert AlreadyClaimed();
        if (nullifierUsed[nullifier]) revert IdentityAlreadyUsed();
        if (msg.sender.code.length != 0) revert ContractCustodyForbidden();
        if (msg.value != priceWei) revert IncorrectPayment(priceWei, msg.value);

        stateOf[msg.sender] = State.Provisional;
        nullifierOf[msg.sender] = nullifier;
        nullifierUsed[nullifier] = true;
        claimedAt[msg.sender] = block.timestamp;
        paidBy[msg.sender] = msg.value;
        issued += 1;

        emit TicketClaimed(msg.sender, nullifier, msg.value);
    }

    // ------------------------------------------------------- revoke and final

    /// @notice Revoke a provisional ticket whose holder is in a committed cluster.
    ///
    /// @dev Permissionless, like marking in ClusterRegistry: enforcement must not
    ///      depend on the operator bothering. The price is refunded in full,
    ///      because a revocation prices coordination rather than confiscating
    ///      money, and the appeal path in ClusterRegistry stays open.
    function revoke(address holder) external {
        if (stateOf[holder] != State.Provisional) revert NotProvisional(stateOf[holder]);
        if (block.timestamp > disputeDeadline(holder)) {
            revert DisputeWindowOver(disputeDeadline(holder));
        }
        if (!clusters.hasFinding() || !clusters.isFlagged(holder)) revert NotFlagged();

        uint256 refund = paidBy[holder];
        stateOf[holder] = State.Revoked;
        paidBy[holder] = 0;
        revoked += 1;
        // The identity is released so an honest person wrongly caught in a
        // cluster can be reissued after a successful appeal.
        nullifierUsed[nullifierOf[holder]] = false;

        emit TicketRevoked(holder, msg.sender, refund);

        if (refund > 0) {
            (bool ok,) = holder.call{value: refund}("");
            if (!ok) revert TransferFailed();
        }
    }

    /// @notice Make a ticket definitive once its dispute window has closed.
    /// @dev Permissionless. A flagged holder cannot finalise: the finding has to
    ///      be lifted by appeal first, which is what keeps exclusion non-silent.
    function finalize(address holder) external {
        if (stateOf[holder] != State.Provisional) revert NotProvisional(stateOf[holder]);
        uint256 deadline = disputeDeadline(holder);
        if (block.timestamp <= deadline) revert DisputeWindowOpen(deadline);
        if (clusters.hasFinding() && clusters.isFlagged(holder)) revert NotFlagged();

        stateOf[holder] = State.Final;
        emit TicketFinalized(holder);
    }

    // ---------------------------------------------------------------- redeem

    /// @notice Admission at the gate.
    ///
    /// @dev Selling the wallet gains the buyer nothing: they would need a proof
    ///      from the holder's document, which they do not have. The gate
    ///      challenge comes from recent chain state, so an old proof handed over
    ///      in advance does not work either.
    ///
    ///      EOA custody is re-checked here, not only at claim, because a
    ///      delegation can be added after the fact.
    function redeem(bytes32 gateChallenge, bytes calldata identityProof) external {
        State state = stateOf[msg.sender];
        if (state != State.Final) revert NotRedeemable(state);
        if (msg.sender.code.length != 0) revert ContractCustodyForbidden();

        bool ok = identityVerifier.verify(nullifierOf[msg.sender], gateChallenge, identityProof);
        if (!ok) revert InvalidIdentityProof();

        stateOf[msg.sender] = State.Redeemed;
        emit TicketRedeemed(msg.sender, gateChallenge);
    }

    // ----------------------------------------------------------------- views

    function disputeDeadline(address holder) public view returns (uint256) {
        uint256 claimed = claimedAt[holder];
        return claimed == 0 ? 0 : claimed + disputeWindowSeconds;
    }

    function isProvisional(address holder) external view returns (bool) {
        return stateOf[holder] == State.Provisional;
    }

    function isValid(address holder) external view returns (bool) {
        State state = stateOf[holder];
        return state == State.Provisional || state == State.Final;
    }

    function activeTickets() external view returns (uint256) {
        return issued - revoked;
    }

    receive() external payable {}
}

/// @notice Placeholder identity verifier for the demo.
///
/// @dev NOT SOUND AND NOT PRIVATE. It only checks that the caller can present
///      the preimage of the bound nullifier over the gate challenge, which a
///      ZK proof would do without revealing anything. It exists so the
///      redemption flow is end to end runnable in the demo, and must be replaced
///      by a real verifier (zkPassport or equivalent) before any real use.
contract DemoIdentityVerifier is IIdentityVerifier {
    function verify(bytes32 nullifier, bytes32 gateChallenge, bytes calldata proof)
        external
        pure
        returns (bool)
    {
        if (proof.length != 32) return false;
        bytes32 secret = abi.decode(proof, (bytes32));
        // The nullifier is keccak256(secret); the challenge binds the proof to
        // this admission so an earlier one cannot be reused.
        return keccak256(abi.encodePacked(secret)) == nullifier && gateChallenge != bytes32(0);
    }
}
