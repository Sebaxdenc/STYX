/**
 * Shared block clock.
 *
 * The qualification screen needs the current block height several times a
 * second to drive a 33-block response countdown. Three naive approaches all
 * fail:
 *
 * - Polling `eth_blockNumber` every block is 3.3 requests per second per user at
 *   a 300 ms block time, and the public endpoint allows 15-25 per second shared
 *   across everyone.
 * - Letting each component poll multiplies that by the number of components.
 * - `eth_subscribe` needs a WebSocket, which the public HTTP endpoint does not
 *   provide.
 *
 * So: one source for the whole tab, resynced on an interval, extrapolating
 * between resyncs from the canonical block time. Drift over a few seconds is
 * well under one block, which is finer than the countdown needs.
 *
 * A WebSocket endpoint, when configured, replaces extrapolation with real
 * `newHeads` events.
 */
import { createPublicClient, webSocket } from "viem";
import { params } from "@/lib/protocol";
import { getPublicClient } from "./client";
import { monadTestnet } from "./config";

const BLOCK_TIME_MS = params.network.blockTimeMs;

/** How often to re-read the authoritative height when extrapolating. */
const RESYNC_INTERVAL_MS = 4_000;

export interface BlockTick {
  /** Best estimate of the current height. */
  readonly blockNumber: bigint;
  /** True when it came from the node rather than from extrapolation. */
  readonly confirmed: boolean;
}

type Listener = (tick: BlockTick) => void;

const wsUrl: string | undefined = process.env.NEXT_PUBLIC_MONAD_WS_URL;

class BlockClock {
  private listeners = new Set<Listener>();
  private anchorBlock = 0n;
  private anchorAt = 0;
  private current = 0n;
  private resyncTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private unwatch: (() => void) | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.current !== 0n) {
      listener({ blockNumber: this.current, confirmed: false });
    }
    this.start();

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  private emit(blockNumber: bigint, confirmed: boolean): void {
    if (blockNumber <= this.current && !confirmed) return;
    this.current = blockNumber;
    for (const listener of this.listeners) {
      listener({ blockNumber, confirmed });
    }
  }

  private anchor(blockNumber: bigint): void {
    this.anchorBlock = blockNumber;
    this.anchorAt = Date.now();
    this.emit(blockNumber, true);
  }

  private async resync(): Promise<void> {
    try {
      const height = await getPublicClient().getBlockNumber();
      this.anchor(height);
    } catch {
      // Keep extrapolating: a failed resync is not a reason to stall the UI.
    }
  }

  private start(): void {
    if (this.resyncTimer !== null || this.unwatch !== null) return;

    if (wsUrl !== undefined && wsUrl.length > 0) {
      const wsClient = createPublicClient({
        chain: monadTestnet,
        transport: webSocket(wsUrl),
      });
      this.unwatch = wsClient.watchBlockNumber({
        emitOnBegin: true,
        onBlockNumber: (blockNumber) => this.anchor(blockNumber),
        onError: () => {
          // Fall back to the polling path if the socket dies.
          this.unwatch?.();
          this.unwatch = null;
          this.startPolling();
        },
      });
      return;
    }

    this.startPolling();
  }

  private startPolling(): void {
    if (this.resyncTimer !== null) return;

    void this.resync();
    this.resyncTimer = setInterval(() => void this.resync(), RESYNC_INTERVAL_MS);

    this.tickTimer = setInterval(() => {
      if (this.anchorAt === 0) return;
      const elapsed = Date.now() - this.anchorAt;
      const projected = this.anchorBlock + BigInt(Math.floor(elapsed / BLOCK_TIME_MS));
      this.emit(projected, false);
    }, BLOCK_TIME_MS);
  }

  private stop(): void {
    if (this.resyncTimer !== null) {
      clearInterval(this.resyncTimer);
      this.resyncTimer = null;
    }
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.unwatch?.();
    this.unwatch = null;
  }

  /** Forces an immediate resync. Call after sending a transaction. */
  async refresh(): Promise<void> {
    await this.resync();
  }
}

export const blockClock = new BlockClock();
