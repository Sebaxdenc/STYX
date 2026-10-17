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
import {
  clusterRegistryAbi,
  enrollmentAbi,
  heartbeatRegistryAbi,
  lotteryAbi,
  ticketRegistryAbi,
} from "./abis";
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

function requireLottery(): `0x${string}` {
  const { lottery } = addresses;
  if (lottery === null) throw new ContractsNotConfiguredError();
  return lottery;
}

function requireTicketRegistry(): `0x${string}` {
  const { ticketRegistry } = addresses;
  if (ticketRegistry === null) throw new ContractsNotConfiguredError();
  return ticketRegistry;
}

function requireClusterRegistry(): `0x${string}` {
  const { clusterRegistry } = addresses;
  if (clusterRegistry === null) throw new ContractsNotConfiguredError();
  return clusterRegistry;
}

/**
 * Collects the right to claim, if selected in the open round.
 *
 * Not a race. The outcome was fixed the moment the seed was finalised, so being
 * fast gains nothing and being slow loses nothing within the round. No human
 * gesture token is required here precisely because no latency is being measured:
 * unlike `respondToChallenge`, this value is not an input to the detector.
 */
export async function claimEntitlement(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: `0x${string}`,
): Promise<`0x${string}`> {
  const fees = await estimateFees(publicClient);

  return walletClient.writeContract({
    address: requireLottery(),
    abi: lotteryAbi,
    functionName: "claimEntitlement",
    account,
    chain: walletClient.chain,
    gas: gasLimits.claimEntitlement,
    ...fees,
  });
}

/**
 * Mints the ticket against an identity nullifier.
 *
 * The nullifier binds one ticket to one real identity rather than to a wallet,
 * because a per-wallet limit is no limit at all when wallets are free. Only the
 * nullifier reaches the chain: no document data leaves the user's device, and no
 * personal data is ever written on chain.
 *
 * The resulting NFT is PROVISIONAL until the dispute window closes.
 */
export async function claimTicket(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: `0x${string}`,
  nullifier: `0x${string}`,
  priceWei: bigint,
): Promise<`0x${string}`> {
  const fees = await estimateFees(publicClient);

  return walletClient.writeContract({
    address: requireTicketRegistry(),
    abi: ticketRegistryAbi,
    functionName: "claimTicket",
    account,
    chain: walletClient.chain,
    args: [nullifier],
    value: priceWei,
    gas: gasLimits.claimTicket,
    ...fees,
  });
}

/** Makes a provisional ticket final once the dispute window has closed. */
export async function finalizeTicket(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: `0x${string}`,
  holder: `0x${string}`,
): Promise<`0x${string}`> {
  const fees = await estimateFees(publicClient);

  return walletClient.writeContract({
    address: requireTicketRegistry(),
    abi: ticketRegistryAbi,
    functionName: "finalize",
    account,
    chain: walletClient.chain,
    args: [holder],
    gas: gasLimits.finalize,
    ...fees,
  });
}

/**
 * Appeals a cluster finding by posting a bond.
 *
 * Mandatory path, not a courtesy: design invariant 3 forbids excluding a wallet
 * on an automated score with no recourse.
 */
export async function appealFinding(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: `0x${string}`,
  appealBond: bigint,
): Promise<`0x${string}`> {
  const fees = await estimateFees(publicClient);

  return walletClient.writeContract({
    address: requireClusterRegistry(),
    abi: clusterRegistryAbi,
    functionName: "appeal",
    account,
    chain: walletClient.chain,
    value: appealBond,
    gas: gasLimits.appeal,
    ...fees,
  });
}
