/**
 * Contract reads.
 *
 * Calls are issued with `Promise.all` and coalesced into a single JSON-RPC batch
 * by the HTTP transport. Multicall3 is deliberately not used: its deployment on
 * Monad testnet is not something this code can assume, and the batch transport
 * achieves the same round-trip saving without that dependency.
 */
import type { PublicClient } from "viem";
import {
  clusterRegistryAbi,
  enrollmentAbi,
  heartbeatRegistryAbi,
  lotteryAbi,
  ticketRegistryAbi,
  type AppealStateValue,
  type EnrollmentPhaseValue,
  type LotteryPhaseValue,
  type TicketStateValue,
} from "./abis";
import { addresses } from "./config";
import type { QualificationWindow } from "./challenge";

export class ContractsNotConfiguredError extends Error {
  constructor() {
    super(
      "Faltan direcciones de contrato. Define NEXT_PUBLIC_ENROLLMENT_ADDRESS, NEXT_PUBLIC_HEARTBEAT_ADDRESS, NEXT_PUBLIC_LOTTERY_ADDRESS, NEXT_PUBLIC_TICKET_REGISTRY_ADDRESS y NEXT_PUBLIC_CLUSTER_REGISTRY_ADDRESS en web/.env.local",
    );
    this.name = "ContractsNotConfiguredError";
  }
}

function requireAddresses(): {
  readonly enrollment: `0x${string}`;
  readonly heartbeatRegistry: `0x${string}`;
  readonly lottery: `0x${string}`;
  readonly ticketRegistry: `0x${string}`;
  readonly clusterRegistry: `0x${string}`;
} {
  const { enrollment, heartbeatRegistry, lottery, ticketRegistry, clusterRegistry } = addresses;
  if (
    enrollment === null ||
    heartbeatRegistry === null ||
    lottery === null ||
    ticketRegistry === null ||
    clusterRegistry === null
  ) {
    throw new ContractsNotConfiguredError();
  }
  return { enrollment, heartbeatRegistry, lottery, ticketRegistry, clusterRegistry };
}

// ------------------------------------------------------------------ enrollment

export interface EnrollmentState {
  readonly phase: EnrollmentPhaseValue;
  /** Unix seconds. The contract bounds this phase by timestamp, not by block. */
  readonly closesAt: bigint;
  readonly enrolledCount: bigint;
  readonly bondAmount: bigint;
  /**
   * Fixed when enrolment closes; zero before that.
   *
   * Read here rather than from `HeartbeatRegistry` because the registry only
   * caches it when qualification opens, which is later. See `cohort.ts`.
   */
  readonly cohortSeed: `0x${string}`;
}

export async function readEnrollmentState(client: PublicClient): Promise<EnrollmentState> {
  const { enrollment } = requireAddresses();
  const base = { address: enrollment, abi: enrollmentAbi } as const;

  const [phase, closesAt, enrolledCount, bondAmount, cohortSeed] = await Promise.all([
    client.readContract({ ...base, functionName: "phase" }),
    client.readContract({ ...base, functionName: "closesAt" }),
    client.readContract({ ...base, functionName: "enrolledCount" }),
    client.readContract({ ...base, functionName: "bondAmount" }),
    client.readContract({ ...base, functionName: "cohortSeed" }),
  ]);

  return {
    phase: phase as EnrollmentPhaseValue,
    closesAt,
    enrolledCount,
    bondAmount,
    cohortSeed,
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

// -------------------------------------------------------------------- lottery

export interface LotteryState {
  readonly phase: LotteryPhaseValue;
  readonly seed: `0x${string}`;
  readonly seedBlock: bigint;
  readonly inventory: bigint;
  readonly issued: bigint;
  readonly currentRound: number;
  readonly currentRoundClosesAt: bigint;
  readonly roundOpen: boolean;
  readonly participationCap: number;
}

export async function readLotteryState(client: PublicClient): Promise<LotteryState> {
  const { lottery } = requireAddresses();
  const base = { address: lottery, abi: lotteryAbi } as const;

  const [
    phase,
    seed,
    seedBlock,
    inventory,
    issued,
    currentRound,
    currentRoundClosesAt,
    roundOpen,
    participationCap,
  ] = await Promise.all([
    client.readContract({ ...base, functionName: "phase" }),
    client.readContract({ ...base, functionName: "seed" }),
    client.readContract({ ...base, functionName: "seedBlock" }),
    client.readContract({ ...base, functionName: "inventory" }),
    client.readContract({ ...base, functionName: "issued" }),
    client.readContract({ ...base, functionName: "currentRound" }),
    client.readContract({ ...base, functionName: "currentRoundClosesAt" }),
    client.readContract({ ...base, functionName: "roundOpen" }),
    client.readContract({ ...base, functionName: "participationCap" }),
  ]);

  return {
    phase: phase as LotteryPhaseValue,
    seed,
    seedBlock,
    inventory,
    issued,
    currentRound,
    currentRoundClosesAt,
    roundOpen,
    participationCap,
  };
}

export interface ParticipantLottery {
  readonly hasEntitlement: boolean;
  readonly wonInRound: number;
  /** Participation capped, then scaled by any cluster finding. */
  readonly weight: bigint;
  /** Outcome in the open round. Fixed by the seed, so recomputable by anyone. */
  readonly selectedInCurrentRound: boolean;
}

export async function readParticipantLottery(
  client: PublicClient,
  participant: `0x${string}`,
  currentRound: number,
): Promise<ParticipantLottery> {
  const { lottery } = requireAddresses();
  const base = { address: lottery, abi: lotteryAbi } as const;

  const [hasEntitlement, wonInRound, weight, selectedInCurrentRound] = await Promise.all([
    client.readContract({ ...base, functionName: "hasEntitlement", args: [participant] }),
    client.readContract({ ...base, functionName: "wonInRound", args: [participant] }),
    client.readContract({ ...base, functionName: "weightOf", args: [participant] }),
    currentRound === 0
      ? Promise.resolve(false)
      : client.readContract({
          ...base,
          functionName: "isSelected",
          args: [participant, currentRound],
        }),
  ]);

  return { hasEntitlement, wonInRound, weight, selectedInCurrentRound };
}

// --------------------------------------------------------------------- ticket

export interface ParticipantTicket {
  readonly state: TicketStateValue;
  /** Unix seconds. Zero when no ticket was claimed. */
  readonly disputeDeadline: bigint;
  readonly tokenId: bigint;
  readonly priceWei: bigint;
}

export async function readParticipantTicket(
  client: PublicClient,
  holder: `0x${string}`,
): Promise<ParticipantTicket> {
  const { ticketRegistry } = requireAddresses();
  const base = { address: ticketRegistry, abi: ticketRegistryAbi } as const;

  const [state, disputeDeadline, tokenId, priceWei] = await Promise.all([
    client.readContract({ ...base, functionName: "stateOf", args: [holder] }),
    client.readContract({ ...base, functionName: "disputeDeadline", args: [holder] }),
    client.readContract({ ...base, functionName: "tokenIdOf", args: [holder] }),
    client.readContract({ ...base, functionName: "priceWei" }),
  ]);

  return { state: state as TicketStateValue, disputeDeadline, tokenId, priceWei };
}

// ------------------------------------------------------------------- clusters

/**
 * Everything needed to satisfy design invariant 3 for one participant.
 *
 * A finding must never exclude silently: the interface has to show the reason,
 * the evidence and the appeal path. The reason is the cluster assignment, the
 * evidence is the committed Merkle root plus the published ruleset and dataset
 * CIDs that let a third party recompute it, and the appeal path is `appeal()`.
 */
export interface ClusterFinding {
  readonly hasFinding: boolean;
  readonly voided: boolean;
  readonly root: `0x${string}`;
  readonly rulesetCid: string;
  readonly datasetCid: string;
  readonly disputeClosesAt: bigint;
  readonly appealBond: bigint;
  readonly flaggedMultiplierBps: bigint;
}

export async function readClusterFinding(client: PublicClient): Promise<ClusterFinding> {
  const { clusterRegistry } = requireAddresses();
  const base = { address: clusterRegistry, abi: clusterRegistryAbi } as const;

  const [
    hasFinding,
    voided,
    root,
    rulesetCid,
    datasetCid,
    disputeClosesAt,
    appealBond,
    flaggedMultiplierBps,
  ] = await Promise.all([
    client.readContract({ ...base, functionName: "hasFinding" }),
    client.readContract({ ...base, functionName: "voided" }),
    client.readContract({ ...base, functionName: "root" }),
    client.readContract({ ...base, functionName: "rulesetCid" }),
    client.readContract({ ...base, functionName: "datasetCid" }),
    client.readContract({ ...base, functionName: "disputeClosesAt" }),
    client.readContract({ ...base, functionName: "appealBond" }),
    client.readContract({ ...base, functionName: "FLAGGED_MULTIPLIER_BPS" }),
  ]);

  return {
    hasFinding,
    voided,
    root,
    rulesetCid,
    datasetCid,
    disputeClosesAt,
    appealBond,
    flaggedMultiplierBps,
  };
}

export interface ParticipantCluster {
  readonly isFlagged: boolean;
  readonly clusterId: bigint;
  readonly appealState: AppealStateValue;
  /** 10000 means untouched. A finding reduces weight, never zeroes it. */
  readonly weightMultiplierBps: bigint;
}

export async function readParticipantCluster(
  client: PublicClient,
  participant: `0x${string}`,
): Promise<ParticipantCluster> {
  const { clusterRegistry } = requireAddresses();
  const base = { address: clusterRegistry, abi: clusterRegistryAbi } as const;

  const [isFlagged, clusterId, appealState, weightMultiplierBps] = await Promise.all([
    client.readContract({ ...base, functionName: "isFlagged", args: [participant] }),
    client.readContract({ ...base, functionName: "clusterOf", args: [participant] }),
    client.readContract({ ...base, functionName: "appealState", args: [participant] }),
    client.readContract({ ...base, functionName: "weightMultiplierBps", args: [participant] }),
  ]);

  return {
    isFlagged,
    clusterId,
    appealState: appealState as AppealStateValue,
    weightMultiplierBps,
  };
}
