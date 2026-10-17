"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { chainIdHex } from "@/lib/chain/config";
import { describeError } from "@/lib/chain/errors";
import {
  ensureMonadTestnet,
  getChainId,
  getInjectedProvider,
  listAccounts,
  requestAccounts,
  watchProvider,
  type Eip1193Provider,
} from "@/lib/chain/provider";

export type WalletStatus =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "wrong-network"
  | "connected";

export interface WalletState {
  readonly status: WalletStatus;
  readonly address: `0x${string}` | null;
  readonly provider: Eip1193Provider | null;
  readonly error: string | null;
  connect(): Promise<void>;
  switchNetwork(): Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { readonly children: ReactNode }) {
  const [provider, setProvider] = useState<Eip1193Provider | null>(null);
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [onCorrectChain, setOnCorrectChain] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState(false);

  // Provider detection must run after mount: `window` does not exist during the
  // server render, and some wallets inject late.
  useEffect(() => {
    const found = getInjectedProvider();
    setProvider(found);
    setDetected(true);
  }, []);

  const sync = useCallback(async (target: Eip1193Provider) => {
    try {
      const [accounts, currentChain] = await Promise.all([
        listAccounts(target),
        getChainId(target),
      ]);
      setAddress(accounts.length > 0 ? (accounts[0] ?? null) : null);
      setOnCorrectChain(currentChain.toLowerCase() === chainIdHex.toLowerCase());
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  // Reconnect silently when the wallet already authorised this origin, and
  // follow account or chain changes: signing with a stale account fails quietly.
  useEffect(() => {
    if (provider === null) return;
    void sync(provider);
    return watchProvider(provider, () => void sync(provider));
  }, [provider, sync]);

  const connect = useCallback(async () => {
    if (provider === null) return;
    setConnecting(true);
    setError(null);
    try {
      const accounts = await requestAccounts(provider);
      setAddress(accounts.length > 0 ? (accounts[0] ?? null) : null);
      await ensureMonadTestnet(provider);
      await sync(provider);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setConnecting(false);
    }
  }, [provider, sync]);

  const switchNetwork = useCallback(async () => {
    if (provider === null) return;
    setError(null);
    try {
      await ensureMonadTestnet(provider);
      await sync(provider);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, [provider, sync]);

  const status: WalletStatus = useMemo(() => {
    if (!detected) return "disconnected";
    if (provider === null) return "unsupported";
    if (connecting) return "connecting";
    if (address === null) return "disconnected";
    if (!onCorrectChain) return "wrong-network";
    return "connected";
  }, [detected, provider, connecting, address, onCorrectChain]);

  const value = useMemo<WalletState>(
    () => ({ status, address, provider, error, connect, switchNetwork }),
    [status, address, provider, error, connect, switchNetwork],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const context = useContext(WalletContext);
  if (context === null) {
    throw new Error("useWallet debe usarse dentro de WalletProvider");
  }
  return context;
}
