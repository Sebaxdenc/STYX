import { params } from "@/lib/protocol";
import type { DetectorReport } from "./report";

/**
 * Deterministic layout for the swarm view.
 *
 * Not a force simulation. `d3-force` or `react-force-graph` would work at demo
 * scale, but the claim the picture makes is about a hundred thousand
 * participants, and iterative relaxation over that many nodes does not run at
 * frame rate. A seeded analytic layout renders the same structure at any size
 * and is reproducible, which matches how the detector itself is built: same
 * input, same output, verifiable by a third party.
 *
 * The structure being shown is the actual finding, not decoration. Independent
 * participants scatter, because independent causes produce independent
 * deviations. A coordinated swarm collapses into a dense clump, because shared
 * infrastructure produces shared noise.
 */

export interface SwarmPoint {
  /** Scattered position, where an independent participant sits. */
  readonly loose: readonly [number, number];
  /** Clustered position. Equal to `loose` for unclustered points. */
  readonly tight: readonly [number, number];
  readonly clusterId: number | null;
  /**
   * Null for unclustered participants.
   *
   * The report deliberately omits their addresses: it serialises clusters and a
   * wallet count, not the unclustered majority. An independent participant has
   * nothing to display, and not carrying their addresses is the better default.
   */
  readonly wallet: string | null;
}

/** Small, fast, seedable PRNG. Same seed gives the same picture. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Box-Muller, for the tight gaussian blobs. */
function gaussian(random: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp01(value: number): number {
  return value < 0.02 ? 0.02 : value > 0.98 ? 0.98 : value;
}

/** Scatter with a mild radial bias, so the cloud reads as organic. */
function scatter(random: () => number): readonly [number, number] {
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(random()) * 0.47;
  return [clamp01(0.5 + Math.cos(angle) * radius), clamp01(0.5 + Math.sin(angle) * radius)];
}

export interface SwarmLayout {
  readonly points: readonly SwarmPoint[];
  readonly clusteredCount: number;
  readonly unclusteredCount: number;
}

export function buildLayout(report: DetectorReport): SwarmLayout {
  // Seeded from the detector's own seed so the picture is tied to the ruleset
  // that produced the finding.
  const random = mulberry32(params.detection.randomSeed);
  const points: SwarmPoint[] = [];

  let clusteredCount = 0;

  for (const cluster of report.clusters) {
    // Cluster centre derived from its id, so a cluster lands in the same place
    // every time the report is rendered.
    const centreRandom = mulberry32(hashString(`cluster:${cluster.cluster_id}`));
    const angle = centreRandom() * Math.PI * 2;
    const radius = 0.22 + centreRandom() * 0.16;
    const centre: readonly [number, number] = [
      clamp01(0.5 + Math.cos(angle) * radius),
      clamp01(0.5 + Math.sin(angle) * radius),
    ];

    // Denser for tighter internal correlation: the visual tightness encodes the
    // measurement rather than being an arbitrary style choice.
    const spread = 0.012 + (1 - Math.min(1, Math.abs(cluster.mean_internal_correlation))) * 0.03;

    for (const wallet of cluster.members) {
      clusteredCount += 1;
      points.push({
        loose: scatter(random),
        tight: [
          clamp01(centre[0] + gaussian(random) * spread),
          clamp01(centre[1] + gaussian(random) * spread),
        ],
        clusterId: cluster.cluster_id,
        wallet,
      });
    }
  }

  const unclusteredCount = Math.max(0, report.wallet_count - clusteredCount);

  for (let index = 0; index < unclusteredCount; index += 1) {
    const position = scatter(random);
    points.push({ loose: position, tight: position, clusterId: null, wallet: null });
  }

  return { points, clusteredCount, unclusteredCount };
}
