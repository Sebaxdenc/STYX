/**
 * viem clients.
 *
 * The read client is a singleton: a new HTTP transport per component would
 * multiply connections against an endpoint limited to 15-25 requests per second.
 */
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Account,
  type PublicClient,
  type WalletClient,
} from "viem";
import { monadTestnet, rpcUrl } from "./config";
import type { Eip1193Provider } from "./provider";

let cachedPublicClient: PublicClient | null = null;

export function getPublicClient(): PublicClient {
  if (cachedPublicClient === null) {
    cachedPublicClient = createPublicClient({
      chain: monadTestnet,
      transport: http(rpcUrl, {
        // Batching matters here: the qualification screen reads several views at
        // once and the public endpoint allows batches of up to 100.
        batch: { wait: 16 },
        retryCount: 2,
      }),
    });
  }
  return cachedPublicClient;
}

export function getWalletClientFor(
  provider: Eip1193Provider,
  account: `0x${string}`,
): WalletClient {
  return createWalletClient({
    account,
    chain: monadTestnet,
    transport: custom(provider),
  });
}

/**
 * Fee parameters for a transaction.
 *
 * The ceiling is deliberately twice the base fee, not viem's default of 1.2x.
 * Monad's base fee controller can rise about 3.6% per block, so three seconds of
 * blocks is up to a 1.42x increase; a 1.2x ceiling then rejects the transaction
 * depending on how the base fee happened to move, which presents as an
 * intermittent and unreproducible failure.
 *
 * Raising the ceiling costs nothing in money, because EIP-1559 charges
 * `base + priority` and `maxFeePerGas` is only an upper bound. It does cost
 * concurrency: Reserve Balance budgets in-flight transactions as
 * `gas_bid * gas_limit`, so a higher ceiling means fewer fit at once.
 */
export interface FeeParams {
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

export async function estimateFees(client: PublicClient): Promise<FeeParams> {
  const fees = await client.estimateFeesPerGas();
  const tip = fees.maxPriorityFeePerGas ?? 0n;
  const base = (fees.maxFeePerGas ?? 0n) - tip;

  return {
    maxPriorityFeePerGas: tip,
    maxFeePerGas: base * 2n + tip,
  };
}

/**
 * Gas limits measured with `forge test --gas-report`, not estimated at runtime.
 *
 * Monad charges the limit rather than the amount used, so these must be tight as
 * well as sufficient. Skipping `eth_estimateGas` also removes one of the four
 * RPC calls a plain `sendTransaction` makes.
 *
 * ARCHITECTURE.md section 4 reports a median of 35,127 execution gas for
 * `respond` with a 58,117 worst case, and roughly 45,000 for `enroll`. The
 * values below add the 21,000 base cost plus headroom.
 */
export const gasLimits = {
  respond: 85_000n,
  enroll: 95_000n,
  withdrawBond: 60_000n,
} as const;

export type { Account, PublicClient, WalletClient };
