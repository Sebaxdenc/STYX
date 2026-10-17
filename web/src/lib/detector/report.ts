/**
 * Shape of the detector's published report.
 *
 * Mirrors exactly what `styx_detector.cli` writes with
 * `json.dumps({... "clusters": [asdict(c) for c in report.clusters]})`.
 *
 * Note what is absent: the CLI does not serialise `unclustered`, even though the
 * `Report` dataclass carries it. The frontend therefore knows how many wallets
 * took part and which ones are in a cluster, but not the addresses of the
 * unclustered majority. That is a reasonable default rather than a gap: an
 * independent participant has nothing to display, and the swarm view only needs
 * their count to render the surrounding cloud.
 */

/** Detection route that produced a cluster. See detector/README.md. */
export type DetectionPath = "identical" | "cohesive" | "multi_signal" | "correlated";

export interface ClusterReport {
  readonly cluster_id: number;
  readonly members: readonly string[];
  readonly path: DetectionPath;
  readonly mean_internal_correlation: number;
  readonly density: number;
  /** Share of members sharing the cluster's modal fingerprint. */
  readonly conjunction_share: number;
  /** Exact-match signals backing the finding: funder, gas params, calldata hash. */
  readonly conjunction_signals: readonly string[];
  /** Degrades deliberately as evasion improves: less confidence, not false certainty. */
  readonly suspicion: number;
}

/**
 * Merkle proof for one flagged wallet.
 *
 * Without these the on-chain commitment is useless: `ClusterRegistry.markFlagged`
 * requires a proof against the committed root, and without marking there is no
 * revocation.
 */
export interface WalletProof {
  readonly clusterId: number;
  readonly proof: readonly string[];
}

export interface DetectorReport {
  readonly merkle_root: string;
  /** Ties the report to the exact ruleset it was generated with. */
  readonly params_digest: string;
  readonly wallet_count: number;
  readonly round_count: number;
  readonly clusters: readonly ClusterReport[];
  /** Keyed by wallet address, as written by `cluster_proofs`. */
  readonly proofs: Readonly<Record<string, WalletProof>>;
}

export function isDetectorReport(value: unknown): value is DetectorReport {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DetectorReport>;
  return (
    typeof candidate.merkle_root === "string" &&
    typeof candidate.params_digest === "string" &&
    typeof candidate.wallet_count === "number" &&
    typeof candidate.round_count === "number" &&
    Array.isArray(candidate.clusters)
  );
}

export function flaggedCount(report: DetectorReport): number {
  return report.clusters.reduce((total, cluster) => total + cluster.members.length, 0);
}

/** Wallets not in any cluster. Derived, since the report omits their addresses. */
export function unclusteredCount(report: DetectorReport): number {
  return Math.max(0, report.wallet_count - flaggedCount(report));
}

/**
 * Human-readable reason a cluster was flagged.
 *
 * Design invariant 3 forbids silent exclusion: a finding must show the reason,
 * the evidence and the appeal path. This supplies the reason; the interface is
 * responsible for the other two.
 */
export function describePath(path: DetectionPath): string {
  switch (path) {
    case "identical":
      return "Latencia constante e idéntica entre wallets. Una varianza nula a lo largo de todas las rondas es por sí misma anómala";
    case "cohesive":
      return "Las desviaciones del grupo comparten un factor latente: el perfil medio predice la desviación de cada miembro";
    case "multi_signal":
      return "El grupo comparte tres o más señales de coincidencia exacta, como financiador, parámetros de gas o hash de calldata";
    case "correlated":
      return "Correlación de latencias por pares por encima del umbral, formando una comunidad densa en el grafo";
  }
}

const SIGNAL_LABELS: Readonly<Record<string, string>> = {
  funder: "dirección financiadora común",
  gas_price: "mismo gasPrice exacto",
  gas_limit: "mismo gasLimit exacto",
  calldata_hash: "mismo hash de calldata",
};

export function describeSignal(signal: string): string {
  return SIGNAL_LABELS[signal] ?? signal;
}
