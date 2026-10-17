"use client";

import { useCallback, useEffect, useState } from "react";
import { getPublicClient, getWalletClientFor } from "@/lib/chain/client";
import { computeCohort, isCohortAssigned } from "@/lib/chain/cohort";
import { describeError } from "@/lib/chain/errors";
import {
  readEnrollmentState,
  readParticipantEnrollment,
  readQualificationConfig,
  type EnrollmentState,
  type ParticipantEnrollment,
  type QualificationConfig,
} from "@/lib/chain/reads";
import { enroll as sendEnroll } from "@/lib/chain/writes";
import { useWallet } from "./use-wallet";

export interface EnrollmentView {
  readonly loading: boolean;
  readonly error: string | null;
  readonly state: EnrollmentState | null;
  readonly config: QualificationConfig | null;
  readonly participant: ParticipantEnrollment | null;
  /** Null until enrolment closes and the seed is fixed. */
  readonly cohort: number | null;
  readonly submitting: boolean;
  enroll(): Promise<void>;
  refresh(): Promise<void>;
}

export function useEnrollment(): EnrollmentView {
  const { address, provider, status } = useWallet();

  const [state, setState] = useState<EnrollmentState | null>(null);
  const [config, setConfig] = useState<QualificationConfig | null>(null);
  const [participant, setParticipant] = useState<ParticipantEnrollment | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const client = getPublicClient();
    try {
      const [nextState, nextConfig] = await Promise.all([
        readEnrollmentState(client),
        readQualificationConfig(client),
      ]);
      setState(nextState);
      setConfig(nextConfig);

      setParticipant(
        address === null ? null : await readParticipantEnrollment(client, address),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : describeError(cause));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enroll = useCallback(async () => {
    if (provider === null || address === null || state === null) return;

    setSubmitting(true);
    setError(null);
    try {
      const publicClient = getPublicClient();
      const walletClient = getWalletClientFor(provider, address);

      // The bond must equal `bondAmount()` exactly or the contract reverts with
      // `IncorrectBond`, so the on-chain value is passed through untouched
      // rather than rebuilt from the parameters file.
      const hash = await sendEnroll(publicClient, walletClient, address, state.bondAmount);
      await publicClient.waitForTransactionReceipt({ hash });
      await refresh();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSubmitting(false);
    }
  }, [provider, address, state, refresh]);

  const cohort =
    state !== null && config !== null && address !== null && isCohortAssigned(state.cohortSeed)
      ? computeCohort(state.cohortSeed, address, config.cohortCount)
      : null;

  return {
    loading: loading && status !== "connecting",
    error,
    state,
    config,
    participant,
    cohort,
    submitting,
    enroll,
    refresh,
  };
}
