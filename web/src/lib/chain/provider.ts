/**
 * Injected wallet access (EIP-1193) and keeping the wallet on Monad testnet.
 */
import { numberToHex } from "viem";
import { chainIdHex, monadTestnet, publicRpcUrl } from "./config";

/** Minimal EIP-1193 surface. Avoids depending on a wallet library's types. */
export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: never[]) => void): void;
  removeListener?(event: string, listener: (...args: never[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

/** The chain is not registered in the wallet yet. */
const CHAIN_NOT_ADDED = 4902;

export function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

function asAddressList(value: unknown): readonly `0x${string}`[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is `0x${string}` => typeof item === "string" && item.startsWith("0x"));
}

export async function requestAccounts(
  provider: Eip1193Provider,
): Promise<readonly `0x${string}`[]> {
  return asAddressList(await provider.request({ method: "eth_requestAccounts" }));
}

/** Accounts already authorised, without prompting. */
export async function listAccounts(
  provider: Eip1193Provider,
): Promise<readonly `0x${string}`[]> {
  return asAddressList(await provider.request({ method: "eth_accounts" }));
}

export async function getChainId(provider: Eip1193Provider): Promise<string> {
  const id = await provider.request({ method: "eth_chainId" });
  return typeof id === "string" ? id : "";
}

/**
 * Switches the wallet to Monad testnet, registering the network if absent.
 *
 * The RPC written here is the PUBLIC one on purpose: this configuration is
 * persisted in each user's wallet, so writing a dedicated endpoint would hand
 * the key to every user and exhaust its quota.
 */
export async function ensureMonadTestnet(provider: Eip1193Provider): Promise<void> {
  const current = await getChainId(provider);
  if (current.toLowerCase() === chainIdHex.toLowerCase()) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    // Anything other than "chain not added" is propagated, including 4001.
    if (code !== CHAIN_NOT_ADDED) throw error;

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: numberToHex(monadTestnet.id),
          chainName: monadTestnet.name,
          nativeCurrency: monadTestnet.nativeCurrency,
          rpcUrls: [publicRpcUrl],
          blockExplorerUrls: [monadTestnet.blockExplorers.default.url],
        },
      ],
    });
  }
}

/**
 * Subscribes to account and chain changes.
 *
 * Required rather than optional: continuing to sign with an account the user
 * already switched away from fails silently.
 */
export function watchProvider(
  provider: Eip1193Provider,
  onChange: () => void,
): () => void {
  provider.on?.("accountsChanged", onChange);
  provider.on?.("chainChanged", onChange);

  return () => {
    provider.removeListener?.("accountsChanged", onChange);
    provider.removeListener?.("chainChanged", onChange);
  };
}
