"use client";

import { useEffect, useState } from "react";

/**
 * Seconds remaining until a unix timestamp, ticking once per second.
 *
 * Compares against the local clock, which can drift from block timestamps by a
 * few seconds. That is acceptable for the enrolment window: it is 48 hours wide
 * precisely so that no deadline-second precision matters. The qualification
 * response window is measured in blocks instead, never here.
 */
export function useCountdown(targetUnixSeconds: bigint | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (targetUnixSeconds === null || targetUnixSeconds === 0n) {
      setRemaining(null);
      return;
    }

    const target = Number(targetUnixSeconds);
    const update = () => setRemaining(Math.max(0, target - Math.floor(Date.now() / 1000)));

    update();
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  }, [targetUnixSeconds]);

  return remaining;
}
