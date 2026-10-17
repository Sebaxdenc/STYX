"""Pipeline completo: latidos a informe publicable."""

from __future__ import annotations

from .cluster import DetectionConfig, detect
from .commitment import cluster_merkle_root, params_digest
from .features import build_feature_matrix
from .model import Heartbeat, Report


def run_detection(
    heartbeats: list[Heartbeat],
    config: DetectionConfig,
    params_used: dict | None = None,
) -> Report:
    """Ejecuta la deteccion y devuelve un informe con su compromiso Merkle.

    El informe es la unidad publicable: raiz Merkle para el commit onchain,
    huella del ruleset para demostrar que se aplicaron las reglas anunciadas, y
    la evidencia de cada cluster para que una impugnacion pueda rebatirla.
    """
    matrix = build_feature_matrix(heartbeats)
    clusters = detect(matrix, config)

    assignments = [(wallet, c.cluster_id) for c in clusters for wallet in c.members]
    flagged = {wallet for wallet, _ in assignments}

    return Report(
        clusters=clusters,
        wallet_count=matrix.n_wallets,
        round_count=matrix.n_rounds,
        unclustered=[w for w in matrix.wallets if w not in flagged],
        merkle_root=cluster_merkle_root(sorted(assignments)),
        params_digest=params_digest(params_used or _config_as_dict(config)),
    )


def _config_as_dict(config: DetectionConfig) -> dict:
    return {
        "correlationThreshold": config.correlation_threshold,
        "minClusterSize": config.min_cluster_size,
        "conjunctionThreshold": config.conjunction_threshold,
        "requireSignalConjunction": config.require_conjunction,
        "minDensity": config.min_density,
        "minOverlap": config.min_overlap,
        "randomSeed": config.random_seed,
    }
