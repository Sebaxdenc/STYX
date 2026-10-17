/**
 * Contract writes.
 *
 * Gas is passed explicitly rather than estimated. A plain `sendTransaction`
 * makes four RPC calls (`eth_estimateGas`, `eth_getTransactionCount`,
 * `eth_feeHistory`, `eth_sendRawTransaction`); supplying gas and fees removes
 * two of them. Monad charges the gas limit rather than the amount consumed, so
 * the values in `gasLimits` are measured, not padded guesses.
 */
import type { PublicClient, WalletClient } from "viem";
import { enrollmentAbi, heartbeatRegistryAbi } from "./abis";
import { addresses } from "./config";
import { estimateFees, gasLimits } from "./client";
import { HumanGesture, MissingHumanGestureError } from "./human-gesture";
import { ContractsNotConfiguredError } from "./reads";

function requireEnrollment(): `0x${string}` {
  const { enrollment } = addresses;
  if (enrollment === null) throw new ContractsNotConfiguredError();
  return enrollment;
}

function requireHeartbeatRegistry(): `0x${string}` {
  const { heartbeatRegistry } = addresses;
  if (heartbeatRegistry === null) throw new ContractsNotConfiguredError();
  return heartbeatRegistry;
}

/**
 * Posts the bond and enrols.
 *
 * `msg.value` must equal `bondAmount()` exactly; the contract reverts with
 * `IncorrectBond` otherwise. The amount is therefore read from the chain and
 * passed through unmodified rather than reconstructed from the parameters file.
 */
export async function enroll(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: `0x${string}`,
  bondAmount: bigint,
): Promise<`0x${string}`> {
  const fees = await estimateFees(publicClient);

  return walletClient.writeContract({
    address: requireEnrollment(),
    abi: enrollmentAbi,
    functionName: "enroll",
    account,
    chain: walletClient.chain,
    value: bondAmount,
    gas: gasLimits.enroll,
    ...fees,
  });
}

export async function withdrawBond(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: `0x${string}`,
): Promise<`0x${string}`> {
  const fees = await estimateFees(publicClient);

  return walletClient.writeContract({
    address: requireEnrollment(),
    abi: enrollmentAbi,
    functionName: "withdrawBond",
    account,
    chain: walletClient.chain,
    gas: gasLimits.withdrawBond,
    ...fees,
  });
}

/**
 * Answers the challenge for `round`.
 *
 * Requires a `HumanGesture`, which can only be minted from a trusted DOM event.
 * This is the enforcement point for design invariant 11: no timer, effect, or
 * retry path can reach this function, because none of them can produce the
 * token. Do not add an overload that omits it.
 */
export async function respondToChallenge(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: `0x${string}`,
  round: number,
  gesture: HumanGesture,
): Promise<`0x${string}`> {
  if (!gesture.consume()) throw new MissingHumanGestureError();

  const fees = await estimateFees(publicClient);

  return walletClient.writeContract({
    address: requireHeartbeatRegistry(),
    abi: heartbeatRegistryAbi,
    functionName: "respond",
    account,
    chain: walletClient.chain,
    args: [round],
    gas: gasLimits.respond,
    ...fees,
  });
}
