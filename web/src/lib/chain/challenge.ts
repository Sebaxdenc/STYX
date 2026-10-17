import { encodePacked, keccak256 } from "viem";

/**
 * Client-side replica of `HeartbeatRegistry.challengeBlockOf`.
 *
 * Why this exists: polling `challengeBlockOf` every block means more than three
 * RPC calls per second per user at a 300 ms block time, which exhausts a public
 * endpoint limited to 15-25 requests per second with a few dozen users. The
 * challenge block is fully determined by the hash of the sub-window's first
 * block, so one read per sub-window (roughly every 30 s) yields the exact
 * timing in advance.
 *
 * This must stay byte-identical to the Solidity. The reference is:
 *
 *   subWindowStart = windowStartBlock + round * subWindowBlocks
 *   h              = blockhash(subWindowStart)
 *   span           = subWindowBlocks - responseWindowBlocks
 *   offset         = keccak256(abi.encodePacked(h, cohort)) % span
 *   challengeBlock = subWindowStart + 1 + offset
 *
 * `abi.encodePacked(bytes32, uint16)` is 34 bytes with no padding, which is what
 * `encodePacked(["bytes32", "uint16"], ...)` produces here. Getting the packing
 * wrong yields a plausible but wrong block, so `assertMatchesContract` below
 * checks the replica against the contract at runtime.
 */

/** The EVM `BLOCKHASH` opcode only reaches 256 blocks back. */
export const BLOCKHASH_WINDOW_BLOCKS = 256n;

export interface QualificationWindow {
  readonly windowStartBlock: bigint;
  readonly challengeCount: number;
  readonly subWindowBlocks: bigint;
  readonly responseWindowBlocks: bigint;
}

export interface ChallengeTiming {
  readonly round: number;
  readonly subWindowStart: bigint;
  /** Block at which the challenge fires. Responses are valid strictly after it. */
  readonly challengeBlock: bigint;
  /** Last block that still accepts a response, inclusive. */
  readonly deadlineBlock: bigint;
}

export function subWindowStartOf(window: QualificationWindow, round: number): bigint {
  return window.windowStartBlock + BigInt(round) * window.subWindowBlocks;
}

/**
 * Resolves the exact challenge timing for a round.
 *
 * @param subWindowHash Hash of block `subWindowStartOf(window, round)`. Must be
 *        the real hash: this value is what makes the timing unpredictable, so it
 *        cannot be derived before that block exists.
 */
export function computeChallengeTiming(
  window: QualificationWindow,
  round: number,
  cohort: number,
  subWindowHash: `0x${string}`,
): ChallengeTiming {
  if (round < 0 || round >= window.challengeCount) {
    throw new Error(`round ${round} outside [0, ${window.challengeCount})`);
  }

  const span = window.subWindowBlocks - window.responseWindowBlocks;
  if (span <= 0n) {
    throw new Error("subWindowBlocks must exceed responseWindowBlocks");
  }

  const subWindowStart = subWindowStartOf(window, round);
  const digest = keccak256(encodePacked(["bytes32", "uint16"], [subWindowHash, cohort]));
  const offset = BigInt(digest) % span;

  const challengeBlock = subWindowStart + 1n + offset;

  return {
    round,
    subWindowStart,
    challengeBlock,
    deadlineBlock: challengeBlock + window.responseWindowBlocks,
  };
}

/**
 * Whether the contract can still verify this round's challenge.
 *
 * `respond` recomputes the challenge block on chain and reverts with
 * `ChallengeUnverifiable` once `blockhash(subWindowStart)` returns zero, which
 * happens as soon as the sub-window start falls outside the 256-block window.
 * At a 300 ms block time that is about 77 seconds, so with 100-block
 * sub-windows only the last two or three rounds remain verifiable.
 *
 * The client can read any historical block hash from the RPC, so it can compute
 * a timing the contract would refuse. The interface must not offer a response
 * button in that case.
 */
export function isVerifiableOnChain(subWindowStart: bigint, currentBlock: bigint): boolean {
  if (subWindowStart >= currentBlock) return false;
  return currentBlock - subWindowStart <= BLOCKHASH_WINDOW_BLOCKS;
}

/** Round whose sub-window contains `currentBlock`, or null if outside the window. */
export function activeRoundAt(
  window: QualificationWindow,
  currentBlock: bigint,
): number | null {
  if (window.windowStartBlock === 0n) return null;
  if (currentBlock < window.windowStartBlock) return null;

  const elapsed = currentBlock - window.windowStartBlock;
  const round = Number(elapsed / window.subWindowBlocks);

  return round < window.challengeCount ? round : null;
}

export type ChallengeState =
  /** Sub-window has not started: the hash does not exist yet. */
  | { readonly kind: "pending" }
  /** Challenge issued; a response is accepted right now. */
  | { readonly kind: "open"; readonly timing: ChallengeTiming; readonly blocksLeft: bigint }
  /** Sub-window started but the challenge block has not arrived. */
  | { readonly kind: "armed"; readonly timing: ChallengeTiming; readonly blocksUntil: bigint }
  /** Deadline passed, or the challenge is no longer verifiable on chain. */
  | { readonly kind: "closed"; readonly timing: ChallengeTiming; readonly reason: "late" | "unverifiable" };

export function challengeStateAt(
  timing: ChallengeTiming,
  currentBlock: bigint,
): ChallengeState {
  if (!isVerifiableOnChain(timing.subWindowStart, currentBlock)) {
    return currentBlock <= timing.subWindowStart
      ? { kind: "pending" }
      : { kind: "closed", timing, reason: "unverifiable" };
  }

  // `respond` requires block.number > challengeBlock, strictly.
  if (currentBlock <= timing.challengeBlock) {
    return { kind: "armed", timing, blocksUntil: timing.challengeBlock - currentBlock + 1n };
  }

  if (currentBlock > timing.deadlineBlock) {
    return { kind: "closed", timing, reason: "late" };
  }

  return { kind: "open", timing, blocksLeft: timing.deadlineBlock - currentBlock };
}

/**
 * Guards the replica against drift from the Solidity.
 *
 * A mismatch means the packing or the formula diverged, which would silently
 * show the wrong countdown and make every response late. Call this once per
 * sub-window with the contract's own answer; it costs one read.
 */
export function assertMatchesContract(
  computed: ChallengeTiming,
  fromContract: bigint,
): void {
  // Zero means the contract considers the challenge unverifiable, which is a
  // different condition rather than a disagreement about the block.
  if (fromContract === 0n) return;

  if (computed.challengeBlock !== fromContract) {
    throw new Error(
      `challenge block mismatch on round ${computed.round}: ` +
        `computed ${computed.challengeBlock}, contract ${fromContract}`,
    );
  }
}
