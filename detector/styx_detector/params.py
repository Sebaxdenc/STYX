"""Carga de protocol-params.json, la fuente unica de verdad.

El detector no define sus propios umbrales: los lee del mismo fichero que los
contratos y la web. Ver invariante 0 en AGENTS.md.
"""

from __future__ import annotations

import json
from pathlib import Path

from .cluster import DetectionConfig

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "protocol-params.json"


def load_raw(path: Path | str | None = None) -> dict:
    target = Path(path) if path is not None else DEFAULT_PATH
    with target.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_config(path: Path | str | None = None) -> tuple[DetectionConfig, dict]:
    """Devuelve la configuracion de deteccion y el subconjunto de params usado.

    El segundo valor es lo que se resume en `params_digest`, de modo que el
    informe quede atado al ruleset exacto con el que se genero.
    """
    raw = load_raw(path)
    detection = raw["detection"]

    config = DetectionConfig(
        correlation_threshold=float(detection["correlationThreshold"]),
        min_cluster_size=int(detection["minClusterSize"]),
        require_conjunction=bool(detection["requireSignalConjunction"]),
        random_seed=int(detection["randomSeed"]),
    )

    algorithm = detection.get("clusteringAlgorithm", "louvain")
    if algorithm != "louvain":
        raise ValueError(
            f"algoritmo de clustering no soportado: {algorithm}. "
            "Nunca usar componentes conexas: el grafo se fusiona por percolacion."
        )

    used = {
        "correlationThreshold": config.correlation_threshold,
        "minClusterSize": config.min_cluster_size,
        "conjunctionThreshold": config.conjunction_threshold,
        "requireSignalConjunction": config.require_conjunction,
        "minDensity": config.min_density,
        "minOverlap": config.min_overlap,
        "clusteringAlgorithm": algorithm,
        "randomSeed": config.random_seed,
    }
    return config, used
