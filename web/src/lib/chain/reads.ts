/**
 * Contract reads.
 *
 * Calls are issued with `Promise.all` and coalesced into a single JSON-RPC batch
 * by the HTTP transport. Multicall3 is deliberately not used: its deployment on
 * Monad testnet is not something this code can assume, and the batch transport
 * achieves the same round-trip saving without that dependency.
 */
import type { PublicClient } from "viem";
import { enrollmentAbi, heartbeatRegistryAbi, type EnrollmentPhaseValue } from "./abis";
import { addresses } from "./config";
import type { QualificationWindow } from "./challenge";

export class ContractsNotConfiguredError extends Error {
  constructor() {
    super(
      "Faltan las direcciones de los contratos. Define NEXT_PUBLIC_ENROLLMENT_ADDRESS y NEXT_PUBLIC_HEARTBEAT_ADDRESS",
    );
    this.name = "ContractsNotConfiguredError";
  }
}

function requireAddresses(): {
  readonly enrollment: `0x${string}`;
  readonly heartbeatRegistry: `0x${string}`;
} {
  const { enrollment, heartbeatRegistry } = addresses;
  if (enrollment === null || heartbeatRegistry === null) {
    throw new ContractsNotConfiguredError();
  }
  return { enrollment, heartbeatRegistry };
}

// ------------------------------------------------------------------ enrollment

export interface EnrollmentState {
  readonly phase: EnrollmentPhaseValue;
  /** Unix seconds. The contract bounds this phase by timestamp, not by block. */
  readonly closesAt: bigint;
  readonly enrolledCount: bigint;
  readonly bondAmount: bigint;
}

export async function readEnrollmentState(client: PublicClient): Promise<EnrollmentState> {
  const { enrollment } = requireAddresses();
  const base = { address: enrollment, abi: enrollmentAbi } as const;

  const [phase, closesAt, enrolledCount, bondAmount] = await Promise.all([
    client.readContract({ ...base, functionName: "phase" }),
    client.readContract({ ...base, functionName: "closesAt" }),
    client.readContract({ ...base, functionName: "enrolledCount" }),
    client.readContract({ ...base, functionName: "bondAmount" }),
  ]);

  return {
    phase: phase as EnrollmentPhaseValue,
    closesAt,
    enrolledCount,
    bondAmount,
  };
}

export interface ParticipantEnrollment {
  readonly isEnrolled: boolean;
  readonly bond: bigint;
  readonly hasWithdrawn: boolean;
}

export async function readParticipantEnrollment(
  client: PublicClient,
  participant: `0x${string}`,
): Promise<ParticipantEnrollment> {
  const { enrollment } = requireAddresses();
  const base = { address: enrollment, abi: enrollmentAbi } as const;

  const [isEnrolled, bond, hasWithdrawn] = await Promise.all([
    client.readContract({ ...base, functionName: "isEnrolled", args: [participant] }),
    client.readContract({ ...base, functionName: "bondOf", args: [participant] }),
    client.readContract({ ...base, functionName: "hasWithdrawn", args: [participant] }),
  ]);

  return { isEnrolled, bond, hasWithdrawn };
}

// --------------------------------------------------------------- qualification

export interface QualificationConfig extends QualificationWindow {
  readonly windowEndBlock: bigint;
  readonly cohortCount: number;
  readonly minResponsesToQualify: number;
}

/**
 * Immutable configuration plus the window start.
 *
 * Everything here except `windowStartBlock` is `immutable` in the contract, so
 * this is read once and kept. `windowStartBlock` is zero until an admin opens
 * the window, which is the signal that qualification has not begun.
 */
export async function readQualificationConfig(
  client: PublicClient,
): Promise<QualificationConfig> {
  const { heartbeatRegistry } = requireAddresses();
  const base = { address: heartbeatRegistry, abi: heartbeatRegistryAbi } as const;

  const [
    windowStartBlock,
    windowEndBlock,
    challengeCount,
    cohortCount,
    subWindowBlocks,
    responseWindowBlocks,
    minResponsesToQualify,
  ] = await Promise.all([
    client.readContract({ ...base, functionName: "windowStartBlock" }),
    client.readContract({ ...base, functionName: "windowEndBlock" }),
    client.readContract({ ...base, functionName: "challengeCount" }),
    client.readContract({ ...base, functionName: "cohortCount" }),
    client.readContract({ ...base, functionName: "subWindowBlocks" }),
    client.readContract({ ...base, functionName: "responseWindowBlocks" }),
    client.readContract({ ...base, functionName: "minResponsesToQualify" }),
  ]);

  return {
    windowStartBlock,
    windowEndBlock,
    challengeCount,
    cohortCount,
    subWindowBlocks: BigInt(subWindowBlocks),
    responseWindowBlocks: BigInt(responseWindowBlocks),
    minResponsesToQualify,
  };
}

export interface ParticipantQualification {
  readonly cohort: number;
  /** Bit `r` set means round `r` was answered. */
  readonly responseBits: number;
  readonly participationScore: number;
  readonly isQualified: boolean;
}

/**
 * Authoritative per-participant qualification state.
 *
 * This is the recovery path when a subscription drops. Rebuilding from
 * `eth_getLogs` is not viable: it is capped at a 100-block range, which at a
 * 300 ms block time is only 30 seconds of history. Re-reading state is one
 * batch and cannot be got wrong.
 */
export async function readParticipantQualification(
  client: PublicClient,
  participant: `0x${string}`,
): Promise<ParticipantQualification> {
  const { heartbeatRegistry } = requireAddresses();
  const base = { address: heartbeatRegistry, abi: heartbeatRegistryAbi } as const;

  const [cohort, responseBits, participationScore, isQualified] = await Promise.all([
    client.readContract({ ...base, functionName: "cohortOf", args: [participant] }),
    client.readContract({ ...base, functionName: "responseBits", args: [participant] }),
    client.readContract({ ...base, functionName: "participationScore", args: [participant] }),
    client.readContract({ ...base, functionName: "isQualified", args: [participant] }),
  ]);

  return { cohort, responseBits, participationScore, isQualified };
}

/** Hash of the sub-window's first block, or null when not yet produced. */
export async function readSubWindowHash(
  client: PublicClient,
  blockNumber: bigint,
): Promise<`0x${string}` | null> {
  try {
    const block = await client.getBlock({ blockNumber });
    return block.hash;
  } catch {
    return null;
  }
}

/** The contract's own answer, used to check the client-side replica. */
export async function readChallengeBlockOf(
  client: PublicClient,
  cohort: number,
  round: number,
): Promise<bigint> {
  const { heartbeatRegistry } = requireAddresses();
  return client.readContract({
    address: heartbeatRegistry,
    abi: heartbeatRegistryAbi,
    functionName: "challengeBlockOf",
    args: [cohort, round],
  });
}

export function hasRespondedTo(responseBits: number, round: number): boolean {
  return (responseBits & (1 << round)) !== 0;
}
