"""STYX: deteccion de coordinacion sobre datos que la cadena registra de forma nativa.

El detector no afirma distinguir bots de personas. Detecta COORDINACION, que es
mucho mas dificil de disimular que el comportamiento individual: el adversario
tiene que ser creible diez mil veces y ademas creible en conjunto.
"""

from .cluster import DetectionConfig, detect
from .cohesion import candidate_groups, expected_null_cohesion, group_cohesion
from .commitment import (
    cluster_merkle_root,
    cluster_proofs,
    leaf_hash,
    merkle_proof,
    merkle_root,
    params_digest,
    verify_proof,
)
from .features import FeatureMatrix, build_feature_matrix
from .model import Cluster, Fingerprint, Heartbeat, Report
from .pipeline import run_detection
from .similarity import distribution_similarity, pairwise_correlation, zero_variance_groups

__all__ = [
    "Cluster",
    "DetectionConfig",
    "FeatureMatrix",
    "Fingerprint",
    "Heartbeat",
    "Report",
    "build_feature_matrix",
    "candidate_groups",
    "cluster_merkle_root",
    "cluster_proofs",
    "detect",
    "merkle_proof",
    "verify_proof",
    "distribution_similarity",
    "expected_null_cohesion",
    "group_cohesion",
    "leaf_hash",
    "merkle_root",
    "pairwise_correlation",
    "params_digest",
    "run_detection",
    "zero_variance_groups",
]
