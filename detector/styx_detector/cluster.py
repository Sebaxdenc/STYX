"""Deteccion de clusters de coordinacion.

Tres rutas, porque ninguna basta por si sola:

1. `identical`  - wallets con vector de latencia constante e identico. Captura al
                  adversario perezoso. Necesaria porque la varianza cero hace
                  indefinida la correlacion de Pearson, de modo que las otras
                  rutas dejarian pasar al enjambre mas obvio de todos.
2. `cohesive`   - grupos que comparten una senal de coincidencia exacta y cuyas
                  desviaciones de latencia comparten un factor latente. Es la
                  ruta que aguanta el jitter, y la razon esta en cohesion.py: la
                  correlacion por pares cae por debajo de cualquier umbral util
                  en cuanto el adversario anade ruido, mientras que el perfil del
                  grupo estima el factor compartido con el ruido reducido en
                  sqrt(n).
3. `correlated` - grafo de similitud sobre la correlacion por pares y deteccion
                  de comunidades por densidad. Captura enjambres muy apretados
                  cuya coincidencia de senales es solo parcial.

Nunca se usan componentes conexas: con millones de aristas espurias el grafo se
fusiona en un unico componente gigante por percolacion y no se detecta nada. Ver
ARCHITECTURE.md seccion 3.
"""

from __future__ import annotations

import math
import warnings
from dataclasses import dataclass

import networkx as nx
import numpy as np

from .cohesion import candidate_groups, expected_null_cohesion, group_cohesion
from .features import FeatureMatrix
from .model import Cluster
from .similarity import pairwise_correlation, zero_variance_groups


@dataclass(slots=True)
class DetectionConfig:
    correlation_threshold: float = 0.8
    min_cluster_size: int = 50
    #: Fraccion minima de miembros que deben compartir una senal exacta.
    conjunction_threshold: float = 0.6
    #: Invariante 12: la correlacion sola produce falsos positivos cuando
    #: usuarios honestos comparten un RPC publico.
    require_conjunction: bool = True
    #: Densidad interna minima. Las aristas por azar se reparten al azar y no
    #: forman grupos densos; un enjambre forma un cuasi-clique.
    min_density: float = 0.5
    min_overlap: int = 4
    random_seed: int = 42
    #: Cohesion minima para la ruta 2. Un grupo independiente da ~1/sqrt(n), es
    #: decir 0,16 para cuarenta miembros; un enjambre con jitter da 0,7 u 0,8.
    min_cohesion: float = 0.45
    #: Y ademas debe superar este multiplo de la cohesion nula esperada, para que
    #: el umbral siga siendo significativo en grupos pequenos.
    cohesion_null_multiplier: float = 3.0
    #: Senales exactas distintas que bastan para marcar un grupo sin mirar la
    #: temporizacion. Tres, para no marcar a los usuarios de un exchange, que
    #: comparten financiador pero nada mas.
    min_shared_signals: int = 3
    #: Limite para la ruta 3. La matriz de correlacion densa es O(N^2) en
    #: memoria: medido, 10.000 wallets son ~5,8 GB y 46 s, y 100.000 serian
    #: ~580 GB. Por encima de este tamano se omite, y el trabajo lo hacen las
    #: rutas de cohesion y multi-senal, que son O(N*R). No se pierde casi nada:
    #: bajo el invariante 12 un cluster necesita senales exactas compartidas de
    #: todos modos, y esos grupos ya los cubre la ruta 2.
    max_dense_wallets: int = 3000


def detect(matrix: FeatureMatrix, config: DetectionConfig) -> list[Cluster]:
    """Devuelve los clusters hallados, ordenados por sospecha descendente."""
    if matrix.n_wallets == 0:
        return []

    clusters: list[Cluster] = []
    claimed: set[str] = set()

    # ---- Ruta 1: vectores constantes identicos -----------------------------
    for members in zero_variance_groups(
        matrix.latency, matrix.wallets, min_responses=config.min_overlap
    ).values():
        if len(members) < config.min_cluster_size:
            continue
        cluster = _build_cluster(
            cluster_id=0,
            members=members,
            path="identical",
            mean_corr=1.0,
            density=1.0,
            matrix=matrix,
            config=config,
            base_signals=["identical_latency_vector"],
        )
        if cluster is not None:
            clusters.append(cluster)
            claimed.update(members)

    # ---- Ruta 2: factor latente en grupos con senal compartida -------------
    # Se parte primero por senal exacta, que es O(N), y solo despues se mide la
    # cohesion. Ese orden satisface el invariante 12 por construccion y protege a
    # los honestos que comparten RPC: comparten factor latente, pero no
    # comparten financiador ni gas, asi que nunca forman grupo candidato.
    for (field, _value), members in sorted(
        candidate_groups(matrix, config.min_cluster_size).items(), key=lambda kv: str(kv[0])
    ):
        members = [w for w in members if w not in claimed]
        if len(members) < config.min_cluster_size:
            continue

        cohesion = group_cohesion(matrix, members, min_overlap=config.min_overlap)
        floor = max(
            config.min_cohesion,
            config.cohesion_null_multiplier * expected_null_cohesion(len(members)),
        )
        signals, _ = _conjunction(members, matrix, config.conjunction_threshold)

        # Dos criterios independientes, y basta uno:
        #
        # a) Cohesion: el grupo comparte un factor latente de temporizacion.
        # b) Multiples senales exactas: un adversario puede escapar de (a) con
        #    jitter suficiente, pero si cien wallets comparten financiador, gas y
        #    calldata, el aprovisionamiento por lotes es evidente sin mirar la
        #    temporizacion. Es importante exigir VARIAS senales: una direccion de
        #    retirada de un exchange produce financiador compartido para miles de
        #    usuarios legitimos, pero no les uniformiza el gas ni el calldata.
        cohesive = cohesion >= floor
        multi_signal = len(signals) >= config.min_shared_signals
        if not (cohesive or multi_signal):
            continue

        cluster = _build_cluster(
            cluster_id=0,
            members=members,
            path="cohesive" if cohesive else "multi_signal",
            mean_corr=cohesion,
            density=1.0,
            matrix=matrix,
            config=config,
            base_signals=[f"shared_{field}"],
        )
        if cluster is not None:
            clusters.append(cluster)
            claimed.update(members)

    # ---- Ruta 3: grafo de correlacion por pares ----------------------------
    remaining = [w for w in matrix.wallets if w not in claimed]
    if len(remaining) > config.max_dense_wallets:
        warnings.warn(
            f"se omite la ruta de correlacion densa: {len(remaining)} wallets superan "
            f"max_dense_wallets={config.max_dense_wallets}. La matriz O(N^2) no cabe en "
            "memoria a esta escala. Las rutas de cohesion y multi-senal siguen activas.",
            RuntimeWarning,
            stacklevel=2,
        )
    elif len(remaining) >= config.min_cluster_size:
        idx = [matrix.index_of(w) for w in remaining]
        sub_latency = matrix.latency[idx, :]
        corr = pairwise_correlation(sub_latency, min_overlap=config.min_overlap)

        graph = _build_graph(remaining, corr, config.correlation_threshold)
        if graph.number_of_edges() > 0:
            communities = nx.community.louvain_communities(
                graph, weight="weight", seed=config.random_seed
            )
            for community in communities:
                members = sorted(community)
                if len(members) < config.min_cluster_size:
                    continue
                density = _density(graph, members)
                if density < config.min_density:
                    continue
                cluster = _build_cluster(
                    cluster_id=0,
                    members=members,
                    path="correlated",
                    mean_corr=_mean_internal_correlation(graph, members),
                    density=density,
                    matrix=matrix,
                    config=config,
                    base_signals=[],
                )
                if cluster is not None:
                    clusters.append(cluster)

    # Orden determinista: por sospecha, desempatando por el primer miembro.
    clusters.sort(key=lambda c: (-c.suspicion, c.members[0]))
    for new_id, cluster in enumerate(clusters):
        cluster.cluster_id = new_id
    return clusters


def _build_graph(wallets: list[str], corr: np.ndarray, threshold: float) -> nx.Graph:
    graph = nx.Graph()
    graph.add_nodes_from(wallets)
    rows, cols = np.where(np.triu(np.nan_to_num(corr, nan=-1.0), k=1) >= threshold)
    for i, j in zip(rows.tolist(), cols.tolist(), strict=True):
        graph.add_edge(wallets[i], wallets[j], weight=float(corr[i, j]))
    return graph


def _density(graph: nx.Graph, members: list[str]) -> float:
    size = len(members)
    if size < 2:
        return 0.0
    internal = graph.subgraph(members).number_of_edges()
    possible = size * (size - 1) / 2
    return internal / possible


def _mean_internal_correlation(graph: nx.Graph, members: list[str]) -> float:
    sub = graph.subgraph(members)
    weights = [data["weight"] for _, _, data in sub.edges(data=True)]
    return float(np.mean(weights)) if weights else 0.0


def _build_cluster(
    *,
    cluster_id: int,
    members: list[str],
    path: str,
    mean_corr: float,
    density: float,
    matrix: FeatureMatrix,
    config: DetectionConfig,
    base_signals: list[str],
) -> Cluster | None:
    """Aplica el requisito de conjuncion y calcula la sospecha.

    Devuelve None si el cluster no supera la conjuncion exigida, de modo que un
    grupo que solo correlaciona, sin ninguna senal exacta compartida, no se
    reporta. Eso es lo que evita acusar a usuarios honestos que comparten RPC.
    """
    signals, share = _conjunction(members, matrix, config.conjunction_threshold)
    # Deduplicado conservando el orden: la senal que definio el grupo candidato
    # suele repetirse en el analisis de conjuncion.
    signals = list(dict.fromkeys(base_signals + signals))

    if config.require_conjunction and not signals:
        return None

    suspicion = mean_corr * density * math.log1p(len(members)) * max(share, 1e-9)

    return Cluster(
        cluster_id=cluster_id,
        members=members,
        path=path,
        mean_internal_correlation=round(mean_corr, 6),
        density=round(density, 6),
        conjunction_share=round(share, 6),
        conjunction_signals=signals,
        suspicion=round(suspicion, 6),
    )


def _conjunction(
    members: list[str], matrix: FeatureMatrix, threshold: float
) -> tuple[list[str], float]:
    """Senales de coincidencia exacta compartidas por el cluster.

    Cada senal cuenta por separado: un enjambre que varie el gas puede seguir
    delatandose por el financiador comun o por el hash de calldata.
    """
    from collections import Counter

    fields = ("funder", "gas_price", "gas_limit", "calldata_hash")
    signals: list[str] = []
    best_share = 0.0

    for name in fields:
        values = Counter()
        for wallet in members:
            fingerprint = matrix.fingerprints.get(wallet)
            if fingerprint is None:
                continue
            value = getattr(fingerprint, name)
            # Un valor vacio o cero no es evidencia de nada.
            if value in ("", 0):
                continue
            values[value] += 1
        if not values:
            continue
        share = max(values.values()) / len(members)
        if share >= threshold:
            signals.append(f"shared_{name}")
            best_share = max(best_share, share)

    return signals, best_share
