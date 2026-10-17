"use client";

import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/use-wallet";
import { truncateAddress } from "@/lib/format";

export function ConnectButton() {
  const { status, address, connect, switchNetwork } = useWallet();

  if (status === "unsupported") {
    return (
      <a
        href="https://faucet.monad.xyz"
        className="font-mono text-xs text-muted-foreground transition-colors duration-200 hover:text-foreground"
      >
        Necesitas una wallet
      </a>
    );
  }

  if (status === "wrong-network") {
    return (
      <Button variant="secondary" onClick={() => void switchNetwork()}>
        Cambiar a Monad testnet
      </Button>
    );
  }

  if (status === "connected" && address !== null) {
    return (
      <span className="font-mono text-xs text-muted-foreground" title={address}>
        {truncateAddress(address)}
      </span>
    );
  }

  return (
    <Button
      variant="secondary"
      disabled={status === "connecting"}
      onClick={() => void connect()}
    >
      {status === "connecting" ? "Conectando" : "Conectar wallet"}
    </Button>
  );
}
