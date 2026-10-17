// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IClusterRegistry, IEnrollmentView, IHeartbeatRegistry} from "./interfaces.sol";

/// @title Lottery
/// @notice Phase 3 of STYX: verifiable allotment among qualified participants.
///
/// # Why a per-participant threshold instead of picking winners
///
/// The obvious design, sorting participants by a random rank and taking the top
/// `inventory`, cannot be executed on chain: iterating over a hundred thousand
/// participants does not fit in any block. Computing the winner set off chain and
/// committing a root would work, but proving set equality in a dispute is hard,
/// and any "first to claim wins" fallback reintroduces exactly the latency race
/// the whole project exists to remove.
///
/// So each participant's outcome is INDEPENDENT and fixed by the seed:
///
///     u   = keccak256(seed, round, participant)
///     win = u < limit(weight(participant))
///
/// Claiming is collection, not competition. Being fast gains nothing, being slow
/// loses nothing, and anyone can recompute any participant's outcome from public
/// data.
///
/// # Why several rounds
///
/// Independent draws make the winner count a binomial variable, so a single round
/// cannot hit `inventory` exactly. Each round therefore targets a conservative
/// fraction of what is left, and the next round absorbs the shortfall.
/// Under-allocation is the safe direction: it only means another round. Over-
/// allocation is unsafe, so it is additionally blocked by a hard cap.
///
/// The round rate is DERIVED from on-chain state by immutable code. There is no
/// admin input anywhere in the draw, per invariant 7.
contract Lottery {
    enum Phase {
        Pending,
        SeedRequested,
        Drawing,
        Closed
    }

    error WrongPhase(Phase expected, Phase actual);
    error Unauthorized();
    error QualificationNotOver();
    error SeedNotReady(uint256 readyAtBlock);
    error SeedExpired();
    error NotQualified();
    error AlreadyWon();
    error NotSelected();
    error InventoryExhausted();
    error NoRoundOpen();
    error RoundStillOpen();
    error AllRoundsUsed();
    error InvalidConfig();

    event SeedRequested(uint256 seedBlock);
    event SeedFinalized(bytes32 seed);
    event RoundOpened(uint8 round, uint256 rateBps, uint256 remaining, uint256 closesAtBlock);
    event EntitlementGranted(address indexed participant, uint8 round, uint256 issued);
    event Closed(uint256 issued, uint256 inventory);

    uint256 private constant BPS = 10_000;
    /// @dev Blocks to wait before the seed block, so the seed cannot be known
    ///      when qualification ends.
    uint256 public constant SEED_DELAY_BLOCKS = 4;
    /// @dev `blockhash` only reaches back 256 blocks, so the seed must be
    ///      finalised within that window or the request has to be redone.
    uint256 public constant SEED_VALIDITY_BLOCKS = 200;
    uint8 public constant MAX_ROUNDS = 8;
    /// @dev Each round targets this share of what is left. Below 100 percent so
    ///      that overshooting `inventory` is vanishingly unlikely.
    uint256 public constant ROUND_SAFETY_BPS = 9000;

    address public immutable admin;
    IEnrollmentView public immutable enrollment;
    IHeartbeatRegistry public immutable heartbeats;
    IClusterRegistry public immutable clusters;

    uint256 public immutable inventory;
    /// @notice Cap on participation weighting. Participation must count, but the
    ///         draw must not become an auction won by whoever runs most machines.
    uint8 public immutable participationCap;
    uint256 public immutable roundLengthBlocks;

    Phase public phase;
    uint256 public seedBlock;
    bytes32 public seed;
    uint256 public issued;

    uint8 public currentRound;
    uint256 public currentRoundClosesAt;
    bool public roundOpen;

    /// @notice Rate used in each round, kept so that any past round stays
    ///         recomputable by a third party. Verifiability is the product.
    mapping(uint8 => uint256) public roundRateBps;

    mapping(address => bool) public hasEntitlement;
    mapping(address => uint8) public wonInRound;

    modifier atPhase(Phase expected) {
        if (phase != expected) revert WrongPhase(expected, phase);
        _;
    }

    constructor(
        address enrollment_,
        address heartbeats_,
        address clusters_,
        uint256 inventory_,
        uint8 participationCap_,
        uint256 roundLengthBlocks_
    ) {
        if (
            enrollment_ == address(0) || heartbeats_ == address(0) || clusters_ == address(0)
                || inventory_ == 0 || participationCap_ == 0 || roundLengthBlocks_ == 0
        ) {
            revert InvalidConfig();
        }

        admin = msg.sender;
        enrollment = IEnrollmentView(enrollment_);
        heartbeats = IHeartbeatRegistry(heartbeats_);
        clusters = IClusterRegistry(clusters_);
        inventory = inventory_;
        participationCap = participationCap_;
        roundLengthBlocks = roundLengthBlocks_;
        phase = Phase.Pending;
    }

    // ------------------------------------------------------------------ seed

    /// @notice Anchor the draw to a future block hash.
    /// @dev Callable by anyone once qualification is over, so the schedule does
    ///      not depend on an operator being online. The seed comes from a block
    ///      that does not exist yet, so nobody can know it while deciding whether
    ///      to participate.
    function requestSeed() external atPhase(Phase.Pending) {
        if (block.number <= heartbeats.windowEndBlock()) revert QualificationNotOver();
        seedBlock = block.number + SEED_DELAY_BLOCKS;
        phase = Phase.SeedRequested;
        emit SeedRequested(seedBlock);
    }

    function finalizeSeed() external atPhase(Phase.SeedRequested) {
        if (block.number <= seedBlock) revert SeedNotReady(seedBlock + 1);
        if (block.number > seedBlock + SEED_VALIDITY_BLOCKS) revert SeedExpired();

        bytes32 h = blockhash(seedBlock);
        if (h == bytes32(0)) revert SeedExpired();

        seed = h;
        phase = Phase.Drawing;
        emit SeedFinalized(h);

        _openRound();
    }

    /// @notice Re-anchor an expired seed request.
    /// @dev Only reachable when the hash window was missed. It cannot be used to
    ///      reroll a seed that was already finalised, because the phase has moved
    ///      on by then.
    function reRequestSeed() external atPhase(Phase.SeedRequested) {
        if (block.number <= seedBlock + SEED_VALIDITY_BLOCKS) revert SeedNotReady(seedBlock + 1);
        seedBlock = block.number + SEED_DELAY_BLOCKS;
        emit SeedRequested(seedBlock);
    }

    // ----------------------------------------------------------------- rounds

    function advanceRound() external atPhase(Phase.Drawing) {
        if (roundOpen && block.number <= currentRoundClosesAt) revert RoundStillOpen();
        roundOpen = false;

        if (issued >= inventory || currentRound >= MAX_ROUNDS) {
            phase = Phase.Closed;
            emit Closed(issued, inventory);
            return;
        }
        _openRound();
    }

    function _openRound() internal {
        uint256 remaining = inventory - issued;
        uint256 pool = _remainingPool();

        // Rate derived from on-chain state only. No admin input, per invariant 7.
        uint256 rate = pool == 0 ? BPS : (remaining * ROUND_SAFETY_BPS) / pool;
        if (rate > BPS) rate = BPS;

        currentRound += 1;
        roundRateBps[currentRound] = rate;
        currentRoundClosesAt = block.number + roundLengthBlocks;
        roundOpen = true;

        emit RoundOpened(currentRound, rate, remaining, currentRoundClosesAt);
    }

    /// @dev Upper bound on participants still eligible. Using enrolled rather
    ///      than qualified keeps it conservative, because the qualified set is
    ///      smaller and cannot be counted on chain without a hot counter. A
    ///      conservative bound under-allocates, which is the safe direction.
    function _remainingPool() internal view returns (uint256) {
        uint256 enrolled = enrollment.enrolledCount();
        return enrolled > issued ? enrolled - issued : 0;
    }

    // ----------------------------------------------------------------- claim

    /// @notice Collect an entitlement if selected in the open round.
    ///
    /// @dev This grants a RIGHT TO CLAIM, not a ticket. The NFT is minted by
    ///      TicketRegistry and stays provisional until the dispute window closes.
    ///      See the ownership stages in ARCHITECTURE.md section 2.
    function claimEntitlement() external atPhase(Phase.Drawing) {
        if (!roundOpen || block.number > currentRoundClosesAt) revert NoRoundOpen();
        if (hasEntitlement[msg.sender]) revert AlreadyWon();
        if (!heartbeats.isQualified(msg.sender)) revert NotQualified();
        if (issued >= inventory) revert InventoryExhausted();
        if (!isSelected(msg.sender, currentRound)) revert NotSelected();

        hasEntitlement[msg.sender] = true;
        wonInRound[msg.sender] = currentRound;
        issued += 1;

        emit EntitlementGranted(msg.sender, currentRound, issued);
    }

    // ----------------------------------------------------------------- views

    /// @notice Effective weight: participation, capped, then scaled by any
    ///         cluster finding.
    /// @dev A finding reduces weight and never zeroes it. Invariant 3.
    function weightOf(address participant) public view returns (uint256) {
        uint8 score = heartbeats.participationScore(participant);
        uint256 capped = score > participationCap ? participationCap : score;
        uint256 multiplier = clusters.weightMultiplierBps(participant);
        if (multiplier > BPS) multiplier = BPS;
        return (capped * multiplier) / BPS;
    }

    /// @notice Whether `participant` is selected in `round`.
    ///
    /// @dev Deterministic given the seed, so anyone can recompute it. There is no
    ///      ordering to exploit and nothing to front-run: the outcome was fixed
    ///      the moment the seed was finalised.
    function isSelected(address participant, uint8 round) public view returns (bool) {
        if (seed == bytes32(0) || round == 0) return false;

        uint256 weight = weightOf(participant);
        if (weight == 0) return false;

        uint64 draw = uint64(uint256(keccak256(abi.encodePacked(seed, round, participant))));
        return draw < _limit(weight, roundRateBps[round]);
    }

    /// @dev Selection probability is `rate * weight / cap`, so a participant at
    ///      the cap draws at the full round rate and one below it draws
    ///      proportionally less.
    function _limit(uint256 weight, uint256 rateBps) internal view returns (uint256) {
        if (rateBps == 0) return 0;
        uint256 w = weight > participationCap ? participationCap : weight;
        return (uint256(type(uint64).max) * rateBps * w) / (BPS * participationCap);
    }

    function remainingInventory() external view returns (uint256) {
        return inventory > issued ? inventory - issued : 0;
    }

    function isRoundOpen() external view returns (bool) {
        return phase == Phase.Drawing && roundOpen && block.number <= currentRoundClosesAt;
    }
}
