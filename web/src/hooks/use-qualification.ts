"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activeRoundAt,
  assertMatchesContract,
  challengeStateAt,
  computeChallengeTiming,
  subWindowStartOf,
  type ChallengeState,
  type ChallengeTiming,
} from "@/lib/chain/challenge";
import { getPublicClient, getWalletClientFor } from "@/lib/chain/client";
import { computeCohort, isCohortAssigned } from "@/lib/chain/cohort";
import { describeError } from "@/lib/chain/errors";
import type { HumanGesture } from "@/lib/chain/human-gesture";
import {
  hasRespondedTo,
  readChallengeBlockOf,
  readEnrollmentState,
  readParticipantQualification,
  readQualificationConfig,
  readSubWindowHash,
  type QualificationConfig,
} from "@/lib/chain/reads";
import { respondToChallenge } from "@/lib/chain/writes";
import { blockClock } from "@/lib/chain/block-clock";
import { useBlockNumber } from "./use-block-number";
import { useWallet } from "./use-wallet";

export interface RoundRecord {
  readonly round: number;
  /** Null until the sub-window's first block exists and its hash is read. */
  readonly timing: ChallengeTiming | null;
  readonly responded: boolean;
  /** Blocks between challenge and response. Only known for rounds answered here. */
  readonly latencyBlocks: number | null;
}

export interface QualificationView {
  readonly loading: boolean;
  readonly error: string | null;
  readonly config: QualificationConfig | null;
  readonly cohort: number | null;
  readonly currentBlock: bigint | null;
  readonly rounds: readonly RoundRecord[];
  readonly score: number;
  readonly isQualified: boolean;
  readonly windowOpen: boolean;
  readonly windowClosed: boolean;
  readonly activeRound: number | null;
  readonly activeState: ChallengeState | null;
  readonly submitting: boolean;
  respond(round: number, gesture: HumanGesture): Promise<void>;
}

/**
 * Latencies measured locally, keyed by participant and window.
 *
 * These cannot be recovered from the chain later. `challengeBlockOf` returns
 * zero once the sub-window start leaves the 256-block hash window, and
 * `eth_getLogs` is capped at a 100-block range, which is 30 seconds of history
 * at a 300 ms block time. The contract keeps a bitmap of which rounds were
 * answered but not how fast, so the per-round latency only exists here.
 */
function historyKey(address: string, windowStartBlock: bigint): string {
  return `styx:latencies:${address.toLowerCase()}:${windowStartBlock.toString()}`;
}

function loadHistory(address: string, windowStartBlock: bigint): Map<number, number> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(historyKey(address, windowStartBlock));
    if (raw === null) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return new Map();

    const result = new Map<number, number>();
    for (const [key, value] of Object.entries(parsed)) {
      const round = Number(key);
      if (Number.isInteger(round) && typeof value === "number") result.set(round, value);
    }
    return result;
  } catch {
    return new Map();
  }
}

function saveHistory(
  address: string,
  windowStartBlock: bigint,
  history: Map<number, number>,
): void {
  if (typeof window === "undefined") return;
  try {
    const plain: Record<string, number> = {};
    for (const [round, latency] of history) plain[String(round)] = latency;
    window.localStorage.setItem(historyKey(address, windowStartBlock), JSON.stringify(plain));
  } catch {
    // A full or blocked storage is not a reason to break the window.
  }
}

export function useQualification(): QualificationView {
  const { address, provider } = useWallet();
  const tick = useBlockNumber();
  const currentBlock = tick?.blockNumber ?? null;

  const [config, setConfig] = useState<QualificationConfig | null>(null);
  const [cohortSeed, setCohortSeed] = useState<`0x${string}` | null>(null);
  const [responseBits, setResponseBits] = useState(0);
  const [score, setScore] = useState(0);
  const [isQualified, setIsQualified] = useState(false);
  const [timings, setTimings] = useState<ReadonlyMap<number, ChallengeTiming>>(new Map());
  const [latencies, setLatencies] = useState<ReadonlyMap<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Sub-windows already resolved, so each hash is fetched exactly once. */
  const resolvedRounds = useRef(new Set<number>());
  /** Replica checked against the contract once per window, not per round. */
  const replicaVerified = useRef(false);

  const cohort = useMemo(
    () =>
      cohortSeed !== null && address !== null && config !== null && isCohortAssigned(cohortSeed)
        ? computeCohort(cohortSeed, address, config.cohortCount)
        : null,
    [cohortSeed, address, config],
  );

  const refreshParticipant = useCallback(async () => {
    if (address === null) return;
    try {
      const state = await readParticipantQualification(getPublicClient(), address);
      setResponseBits(state.responseBits);
      setScore(state.participationScore);
      setIsQualified(state.isQualified);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, [address]);

  // Immutable configuration and the cohort seed: read once.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const client = getPublicClient();
        const [nextConfig, enrollmentState] = await Promise.all([
          readQualificationConfig(client),
          readEnrollmentState(client),
        ]);
        if (cancelled) return;
        setConfig(nextConfig);
        setCohortSeed(enrollmentState.cohortSeed);
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : describeError(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshParticipant();
  }, [refreshParticipant]);

  // Restore locally measured latencies for this window.
  useEffect(() => {
    if (address === null || config === null || config.windowStartBlock === 0n) return;
    setLatencies(loadHistory(address, config.windowStartBlock));
  }, [address, config]);

  /*
   * Resolve each sub-window's challenge timing as its first block appears.
   *
   * One `getBlock` per sub-window, roughly every 30 s, instead of polling
   * `challengeBlockOf` every block. The hash cannot be known before that block
   * exists, which is exactly what makes the challenge instant unpredictable.
   */
  useEffect(() => {
    if (config === null || cohort === null || currentBlock === null) return;
    if (config.windowStartBlock === 0n) return;

    void (async () => {
      const client = getPublicClient();

      for (let round = 0; round < config.challengeCount; round += 1) {
        if (resolvedRounds.current.has(round)) continue;

        const start = subWindowStartOf(config, round);
        if (currentBlock < start) break;

        resolvedRounds.current.add(round);

        const hash = await readSubWindowHash(client, start);
        if (hash === null) {
          resolvedRounds.current.delete(round);
          continue;
        }

        const timing = computeChallengeTiming(config, round, cohort, hash);

        // Guard the replica against drift from the Solidity. A mismatch would
        // silently show the wrong countdown and make every response late.
        if (!replicaVerified.current) {
          replicaVerified.current = true;
          try {
            const fromContract = await readChallengeBlockOf(client, cohort, round);
            assertMatchesContract(timing, fromContract);
          } catch (cause) {
            setError(describeError(cause));
          }
        }

        setTimings((previous) => new Map(previous).set(round, timing));
      }
    })();
  }, [config, cohort, currentBlock]);

  const respond = useCallback(
    async (round: number, gesture: HumanGesture) => {
      if (provider === null || address === null || config === null) return;

      setSubmitting(true);
      setError(null);
      try {
        const publicClient = getPublicClient();
        const walletClient = getWalletClientFor(provider, address);

        const hash = await respondToChallenge(
          publicClient,
          walletClient,
          address,
          round,
          gesture,
        );
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        const timing = timings.get(round);
        if (timing !== undefined) {
          const latency = Number(receipt.blockNumber - timing.challengeBlock);
          setLatencies((previous) => {
            const next = new Map(previous).set(round, latency);
            saveHistory(address, config.windowStartBlock, next);
            return next;
          });
        }

        await Promise.all([refreshParticipant(), blockClock.refresh()]);
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        setSubmitting(false);
      }
    },
    [provider, address, config, timings, refreshParticipant],
  );

  const rounds = useMemo<readonly RoundRecord[]>(() => {
    if (config === null) return [];
    return Array.from({ length: config.challengeCount }, (_unused, round) => ({
      round,
      timing: timings.get(round) ?? null,
      responded: hasRespondedTo(responseBits, round),
      latencyBlocks: latencies.get(round) ?? null,
    }));
  }, [config, timings, responseBits, latencies]);

  const activeRound =
    config !== null && currentBlock !== null ? activeRoundAt(config, currentBlock) : null;

  const activeState = useMemo<ChallengeState | null>(() => {
    if (activeRound === null || currentBlock === null) return null;
    const timing = timings.get(activeRound);
    if (timing === undefined) return { kind: "pending" };
    return challengeStateAt(timing, currentBlock);
  }, [activeRound, currentBlock, timings]);

  const windowOpen =
    config !== null &&
    currentBlock !== null &&
    config.windowStartBlock !== 0n &&
    currentBlock >= config.windowStartBlock &&
    currentBlock < config.windowEndBlock;

  const windowClosed =
    config !== null &&
    currentBlock !== null &&
    config.windowStartBlock !== 0n &&
    currentBlock >= config.windowEndBlock;

  return {
    loading,
    error,
    config,
    cohort,
    currentBlock,
    rounds,
    score,
    isQualified,
    windowOpen,
    windowClosed,
    activeRound,
    activeState,
    submitting,
    respond,
  };
}
