import { formatEther } from "viem";
import { params } from "@/lib/protocol";

/**
 * MON amount for display.
 *
 * Trims trailing zeros so a whole-token bond reads as "20 MON" rather than
 * "20.000000000000000000 MON", while keeping precision when it matters.
 */
export function formatMon(wei: bigint): string {
  const exact = formatEther(wei);
  if (!exact.includes(".")) return exact;
  return exact.replace(/\.?0+$/, "");
}

export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Coarse duration in Spanish, largest two units.
 *
 * Used for the enrolment countdown, which spans days. Deliberately not
 * second-precise: a 48-hour window that ticks every second suggests a race,
 * which is exactly the wrong idea to convey here.
 */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "cerrado";

  const seconds = Math.floor(totalSeconds);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds % 60} s`;
  return `${seconds} s`;
}

/** Blocks as seconds, using the canonical block time. */
export function blocksToSecondsLabel(blocks: bigint): string {
  const seconds = (Number(blocks) * params.network.blockTimeMs) / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  return `${Math.round(seconds)} s`;
}

export function formatCount(value: number | bigint): string {
  return new Intl.NumberFormat("es-ES").format(value);
}
