"use client";

import { useEffect, useState } from "react";
import { blockClock, type BlockTick } from "@/lib/chain/block-clock";

/**
 * Current block height, from the shared clock.
 *
 * Every consumer attaches to one source, so mounting this in ten components
 * costs the same RPC traffic as mounting it in one.
 */
export function useBlockNumber(): BlockTick | null {
  const [tick, setTick] = useState<BlockTick | null>(null);

  useEffect(() => {
    return blockClock.subscribe(setTick);
  }, []);

  return tick;
}
