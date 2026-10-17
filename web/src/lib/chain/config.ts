import { defineChain } from "viem";
import { params } from "@/lib/protocol";

/**
 * Chain definition built from `protocol-params.json` rather than imported from
 * `viem/chains`.
 *
 * viem ships `monadTestnet`, but design invariant 0 makes the JSON the single
 * source of truth for chain id and RPC URL. Deriving the chain from it keeps one
 * authority instead of two that can silently disagree.
 */
export const monadTestnet = defineChain({
  id: params.network.testnet.chainId,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [params.network.testnet.rpc] },
  },
  blockExplorers: {
    default: {
      name: "MonadExplorer",
      url: "https://testnet.monadexplorer.com",
    },
  },
  testnet: true,
});

/**
 * RPC used by this client. May be a dedicated endpoint: the public one is rate
 * limited to roughly 15-25 requests per second shared across everyone, which a
 * few dozen concurrent users exhaust.
 *
 * This value is embedded in the JavaScript bundle and is therefore NOT secret.
 * Restrict a dedicated key by domain in the provider dashboard; never rely on it
 * being hidden.
 */
export const rpcUrl: string =
  process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? params.network.testnet.rpc;

/**
 * Public RPC, used only for `wallet_addEthereumChain`.
 *
 * That configuration is persisted in each user's wallet, so a dedicated
 * endpoint must never be written there: it would hand the key to every user and
 * burn the quota.
 */
export const publicRpcUrl: string = params.network.testnet.rpc;

export const chainIdHex = `0x${params.network.testnet.chainId.toString(16)}` as const;

function readAddress(value: string | undefined): `0x${string}` | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null;
  return trimmed as `0x${string}`;
}

/** Deployed contract addresses. Null until configured in the environment. */
export const addresses = {
  enrollment: readAddress(process.env.NEXT_PUBLIC_ENROLLMENT_ADDRESS),
  heartbeatRegistry: readAddress(process.env.NEXT_PUBLIC_HEARTBEAT_ADDRESS),
} as const;

export function isDeployed(): boolean {
  return addresses.enrollment !== null && addresses.heartbeatRegistry !== null;
}
