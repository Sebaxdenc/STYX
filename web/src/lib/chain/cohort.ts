import { encodePacked, keccak256 } from "viem";

/**
 * Client-side replica of `HeartbeatRegistry.cohortOf`.
 *
 * Why not just call the contract: `HeartbeatRegistry` caches its own
 * `cohortSeed` when an admin calls `openQualification`, and that storage slot is
 * zero until then. Calling `cohortOf` earlier does not fail; it returns
 * `keccak256(0, participant) % cohortCount`, which is a plausible-looking but
 * meaningless cohort. Showing that to a participant would be a lie.
 *
 * `Enrollment.cohortSeed` is fixed earlier, when enrolment closes, and holds the
 * same value the registry later caches. So once enrolment is closed the cohort
 * can be computed here and displayed honestly, before qualification opens.
 *
 * The seed is fixed at close, rather than known up front, so that addresses
 * cannot be ground out in advance to land in a chosen cohort.
 */
export function computeCohort(
  cohortSeed: `0x${string}`,
  participant: `0x${string}`,
  cohortCount: number,
): number {
  if (cohortCount <= 0) throw new Error("cohortCount must be positive");

  const digest = keccak256(encodePacked(["bytes32", "address"], [cohortSeed, participant]));
  return Number(BigInt(digest) % BigInt(cohortCount));
}

const ZERO_SEED = `0x${"0".repeat(64)}`;

/** A zero seed means enrolment has not closed and no cohort is assigned yet. */
export function isCohortAssigned(cohortSeed: `0x${string}`): boolean {
  return cohortSeed !== ZERO_SEED;
}
