"use client";

import { useCallback, useEffect, useState } from "react";
import { LotteryPhase, TicketState, type LotteryPhaseValue } from "@/lib/chain/abis";
import {
  getPublicClient,
  getWalletClientFor,
  type PublicClient,
  type WalletClient,
} from "@/lib/chain/client";
import { describeError } from "@/lib/chain/errors";
import {
  readClusterFinding,
  readLotteryState,
  readParticipantCluster,
  readParticipantEnrollment,
  readParticipantLottery,
  readParticipantQualification,
  readParticipantTicket,
  type ClusterFinding,
  type LotteryState,
  type ParticipantCluster,
  type ParticipantLottery,
  type ParticipantTicket,
} from "@/lib/chain/reads";
import {
  appealFinding,
  claimEntitlement as sendClaimEntitlement,
  claimTicket as sendClaimTicket,
  finalizeTicket,
} from "@/lib/chain/writes";
import { ensureIdentity } from "@/lib/identity";
import { useWallet } from "./use-wallet";

/**
 * Ownership stage, mirroring the table in ARCHITECTURE.md section 2.
 *
 * Kept as an explicit ladder rather than a boolean because the whole point is
 * that these are different things: a right to claim is not a ticket, and a
 * provisional NFT is not a final one. The interface must not blur them.
 */
export type OwnershipStage =
  | "unenrolled"
  | "enrolled"
  | "qualified"
  | "selected"
  | "claimed"
  | "final"
  | "redeemed"
  | "revoked";

export interface AllotmentView {
  readonly loading: boolean;
  readonly error: string | null;
  readonly lottery: LotteryState | null;
  readonly participant: ParticipantLottery | null;
  readonly ticket: ParticipantTicket | null;
  readonly finding: ClusterFinding | null;
  readonly cluster: ParticipantCluster | null;
  readonly isQualified: boolean;
  readonly participationScore: number;
  readonly stage: OwnershipStage;
  readonly submitting: boolean;
  claimEntitlement(): Promise<void>;
  claimTicket(): Promise<void>;
  finalize(): Promise<void>;
  appeal(): Promise<void>;
  refresh(): Promise<void>;
}

function deriveStage(
  isEnrolled: boolean,
  isQualified: boolean,
  hasEntitlement: boolean,
  ticketState: number,
): OwnershipStage {
  if (ticketState === TicketState.Redeemed) return "redeemed";
  if (ticketState === TicketState.Revoked) return "revoked";
  if (ticketState === TicketState.Final) return "final";
  if (ticketState === TicketState.Provisional) return "claimed";
  if (hasEntitlement) return "selected";
  if (isQualified) return "qualified";
  if (isEnrolled) return "enrolled";
  return "unenrolled";
}

export function useAllotment(): AllotmentView {
  const { address, provider } = useWallet();

  const [lottery, setLottery] = useState<LotteryState | null>(null);
  const [participant, setParticipant] = useState<ParticipantLottery | null>(null);
  const [ticket, setTicket] = useState<ParticipantTicket | null>(null);
  const [finding, setFinding] = useState<ClusterFinding | null>(null);
  const [cluster, setCluster] = useState<ParticipantCluster | null>(null);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [isQualified, setIsQualified] = useState(false);
  const [participationScore, setParticipationScore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const client = getPublicClient();
    try {
      const [nextLottery, nextFinding] = await Promise.all([
        readLotteryState(client),
        readClusterFinding(client),
      ]);
      setLottery(nextLottery);
      setFinding(nextFinding);

      if (address !== null) {
        const [
          nextParticipant,
          nextTicket,
          nextCluster,
          enrollmentState,
          qualification,
        ] = await Promise.all([
          readParticipantLottery(client, address, nextLottery.currentRound),
          readParticipantTicket(client, address),
          readParticipantCluster(client, address),
          readParticipantEnrollment(client, address),
          readParticipantQualification(client, address),
        ]);
        setParticipant(nextParticipant);
        setTicket(nextTicket);
        setCluster(nextCluster);
        setIsEnrolled(enrollmentState.isEnrolled);
        setIsQualified(qualification.isQualified);
        setParticipationScore(qualification.participationScore);
      }

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

  /**
   * Wraps a write so every path reports failures the same way.
   *
   * The action receives an already-narrowed wallet client rather than reading
   * `provider` from the closure, which keeps the null checks in one place
   * instead of forcing a non-null assertion at each call site.
   */
  const run = useCallback(
    async (
      action: (context: {
        readonly account: `0x${string}`;
        readonly walletClient: WalletClient;
        readonly publicClient: PublicClient;
      }) => Promise<`0x${string}`>,
    ) => {
      if (provider === null || address === null) return;

      setSubmitting(true);
      setError(null);
      try {
        const publicClient = getPublicClient();
        const walletClient = getWalletClientFor(provider, address);

        const hash = await action({ account: address, walletClient, publicClient });
        await publicClient.waitForTransactionReceipt({ hash });
        await refresh();
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        setSubmitting(false);
      }
    },
    [provider, address, refresh],
  );

  const claimEntitlement = useCallback(
    () =>
      run(({ account, walletClient, publicClient }) =>
        sendClaimEntitlement(publicClient, walletClient, account),
      ),
    [run],
  );

  const claimTicket = useCallback(
    () =>
      run(({ account, walletClient, publicClient }) => {
        // The secret is created once and archived rather than overwritten:
        // losing it makes the ticket permanently unredeemable.
        const identity = ensureIdentity();
        return sendClaimTicket(
          publicClient,
          walletClient,
          account,
          identity.nullifier,
          ticket?.priceWei ?? 0n,
        );
      }),
    [run, ticket],
  );

  const finalize = useCallback(
    () =>
      run(({ account, walletClient, publicClient }) =>
        finalizeTicket(publicClient, walletClient, account, account),
      ),
    [run],
  );

  const appeal = useCallback(
    () =>
      run(({ account, walletClient, publicClient }) =>
        appealFinding(publicClient, walletClient, account, finding?.appealBond ?? 0n),
      ),
    [run, finding],
  );

  const stage = deriveStage(
    isEnrolled,
    isQualified,
    participant?.hasEntitlement === true,
    ticket?.state ?? TicketState.None,
  );

  return {
    loading,
    error,
    lottery,
    participant,
    ticket,
    finding,
    cluster,
    isQualified,
    participationScore,
    stage,
    submitting,
    claimEntitlement,
    claimTicket,
    finalize,
    appeal,
    refresh,
  };
}

export { LotteryPhase, type LotteryPhaseValue };
