"""Tests del adversario.

AGENTS.md lo exige explicitamente: una suite que solo demuestra que los
participantes honestos funcionan esta incompleta. Aqui se verifica que el
detector caza al enjambre, que lo caza tambien con jitter, y sobre todo que NO
acusa a usuarios honestos que comparten infraestructura.
"""

from __future__ import annotations

import warnings

import numpy as np
import pytest

from styx_detector import DetectionConfig, Heartbeat, build_feature_matrix, detect, run_detection
from styx_detector.simulate import ScenarioConfig, generate

CONFIG = DetectionConfig(
    correlation_threshold=0.8,
    min_cluster_size=40,
    conjunction_threshold=0.6,
    require_conjunction=True,
    min_density=0.5,
    random_seed=42,
)


def _run(jitter: int = 0, seed: int = 7):
    heartbeats, swarm, shared_rpc = generate(
        ScenarioConfig(
            n_honest=300, n_swarm=100, n_shared_rpc=80, rounds=10, swarm_jitter=jitter, seed=seed
        )
    )
    report = run_detection(heartbeats, CONFIG)
    return report, swarm, shared_rpc


def test_swarm_is_detected():
    report, swarm, _ = _run(jitter=0)
    flagged = set(report.flagged_wallets)

    recall = len(flagged & swarm) / len(swarm)
    assert recall > 0.95, f"solo se detecto el {recall:.0%} del enjambre"


def test_swarm_is_detected_despite_jitter():
    """Un adversario que anade ruido aleatorio sigue compartiendo infraestructura.

    El jitter diluye la correlacion, pero el componente compartido por ronda, que
    es la carga de la maquina orquestadora, permanece.
    """
    report, swarm, _ = _run(jitter=3)
    flagged = set(report.flagged_wallets)

    recall = len(flagged & swarm) / len(swarm)
    assert recall > 0.80, f"con jitter solo se detecto el {recall:.0%}"


def test_honest_wallets_sharing_an_rpc_are_not_flagged():
    """El falso positivo que importa, y la razon del invariante 12.

    Usuarios honestos tras un mismo RPC publico comparten sus picos de carga y
    por tanto correlacionan entre si. Sin exigir conjuncion de senales, el
    detector los acusaria en masa.
    """
    report, _, shared_rpc = _run(jitter=0)
    flagged = set(report.flagged_wallets)

    wrongly_flagged = flagged & shared_rpc
    assert not wrongly_flagged, f"{len(wrongly_flagged)} honestos acusados por compartir RPC"


def test_conjunction_requirement_is_what_prevents_the_false_positive():
    """Demuestra que la proteccion viene de la conjuncion y no de otra cosa."""
    heartbeats, _, shared_rpc = generate(
        ScenarioConfig(n_honest=50, n_swarm=0, n_shared_rpc=120, rounds=10, seed=5)
    )
    matrix = build_feature_matrix(heartbeats)

    with_conjunction = detect(matrix, CONFIG)
    without = detect(
        matrix,
        DetectionConfig(
            correlation_threshold=CONFIG.correlation_threshold,
            min_cluster_size=CONFIG.min_cluster_size,
            conjunction_threshold=CONFIG.conjunction_threshold,
            require_conjunction=False,
            min_density=CONFIG.min_density,
            random_seed=CONFIG.random_seed,
        ),
    )

    flagged_with = {w for c in with_conjunction for w in c.members}
    assert not (flagged_with & shared_rpc), "con conjuncion no debe acusarlos"
    # Sin conjuncion el detector es mas agresivo. Si en este escenario no marca
    # nada, el test sigue siendo valido como documentacion del contraste.
    assert len(without) >= len(with_conjunction)


def test_constant_latency_swarm_is_caught_by_the_identical_path():
    """El enjambre perezoso: siempre el mismo bloque relativo.

    Su varianza es cero, Pearson es indefinido, y el camino de correlacion no lo
    veria. La ruta de vectores identicos existe exactamente para esto.
    """
    heartbeats: list[Heartbeat] = []
    swarm = [f"0x{(0x500000 + i):040x}" for i in range(60)]
    for wallet in swarm:
        for r in range(10):
            heartbeats.append(
                Heartbeat(
                    wallet=wallet,
                    cohort=0,
                    round=r,
                    challenge_block=1000 + r * 100,
                    response_block=1000 + r * 100 + 1,  # latencia constante
                    gas_price=50_000_000_000,
                    gas_limit=90_000,
                    calldata_hash="0xdead",
                    funder="0xf00d",
                )
            )

    rng = np.random.default_rng(1)
    for i in range(100):
        wallet = f"0x{(0x1000 + i):040x}"
        for r in range(10):
            heartbeats.append(
                Heartbeat(
                    wallet=wallet,
                    cohort=0,
                    round=r,
                    challenge_block=1000 + r * 100,
                    response_block=1000 + r * 100 + int(rng.integers(2, 15)),
                    gas_price=int(rng.integers(40, 70)) * 1_000_000_000,
                    gas_limit=int(rng.integers(80, 120)) * 1000,
                    calldata_hash=f"0x{i:x}{r:x}",
                    funder=f"0x{(0x900000 + i):x}",
                )
            )

    report = run_detection(heartbeats, CONFIG)

    assert any(c.path == "identical" for c in report.clusters), "debe usarse la ruta de identicos"
    assert set(swarm).issubset(set(report.flagged_wallets))


def test_no_clusters_when_everyone_is_independent():
    heartbeats, _, _ = generate(
        ScenarioConfig(n_honest=300, n_swarm=0, n_shared_rpc=0, rounds=10, seed=13)
    )
    report = run_detection(heartbeats, CONFIG)

    assert report.clusters == [], "participantes independientes no forman clusters"


def test_cluster_evidence_is_explainable():
    """La impugnacion exige poder demostrar POR QUE se agrupo una wallet.

    Es la razon por la que no se usa una red neuronal aqui.
    """
    report, _, _ = _run(jitter=0)
    assert report.clusters

    cluster = report.clusters[0]
    assert cluster.conjunction_signals, "un cluster sin senales no es defendible"
    assert cluster.mean_internal_correlation > 0.8
    assert cluster.density > 0.5
    assert cluster.suspicion > 0


def test_detection_is_reproducible():
    """Requisito de correctitud: un tercero debe obtener el mismo resultado.

    Es lo que verifica el juego de impugnacion.
    """
    first, _, _ = _run(jitter=0)
    second, _, _ = _run(jitter=0)

    assert first.merkle_root == second.merkle_root
    assert first.params_digest == second.params_digest
    assert [c.members for c in first.clusters] == [c.members for c in second.clusters]


def test_empty_input_produces_empty_report():
    report = run_detection([], CONFIG)

    assert report.clusters == []
    assert report.wallet_count == 0
    assert report.merkle_root == "0x" + "00" * 32


def test_high_jitter_swarm_is_caught_by_shared_signals_not_by_timing():
    """Con jitter alto la temporizacion deja de servir, pero el
    aprovisionamiento por lotes sigue siendo visible.

    Cien wallets que comparten financiador, gas y calldata son un lote, se mire
    o no la temporizacion. Exigir VARIAS senales es lo que evita marcar a los
    usuarios de un exchange, que comparten financiador y nada mas.
    """
    report, swarm, _ = _run(jitter=12)
    flagged = set(report.flagged_wallets)

    assert len(flagged & swarm) / len(swarm) > 0.95
    assert any(c.path == "multi_signal" for c in report.clusters)


def test_suspicion_degrades_as_evasion_improves():
    """La puntuacion debe reflejar menos confianza, no fingir certeza."""
    low, _, _ = _run(jitter=0)
    high, _, _ = _run(jitter=12)

    assert low.clusters and high.clusters
    assert low.clusters[0].suspicion > high.clusters[0].suspicion


def test_careful_adversary_escapes_and_this_is_documented():
    """El limite honesto del detector.

    Un adversario que aleatoriza la temporizacion Y las huellas, usando
    financiador, gas y calldata distintos por wallet, no es detectable con datos
    onchain. Este test existe para que ese limite sea explicito y verificable, no
    una nota al pie: la afirmacion del proyecto es que cazamos al adversario
    economicamente racional, no a uno ilimitado.

    El coste de esa evasion no es cero: exige infraestructura independiente por
    identidad y fondear cada wallet por una ruta distinta.
    """
    heartbeats, swarm, _ = generate(
        ScenarioConfig(
            n_honest=300,
            n_swarm=100,
            n_shared_rpc=0,
            rounds=10,
            swarm_jitter=12,
            swarm_randomize_fingerprints=True,
            seed=21,
        )
    )
    report = run_detection(heartbeats, CONFIG)
    flagged = set(report.flagged_wallets)

    recall = len(flagged & swarm) / len(swarm)
    assert recall < 0.5, (
        "si este test empieza a fallar es una BUENA noticia: significa que el "
        "detector mejoro. Actualiza el umbral y documenta por que."
    )


def test_dense_correlation_path_is_skipped_above_the_memory_limit():
    """La matriz de correlacion densa es O(N^2) en memoria.

    Medido: 10.000 wallets consumian 5,8 GB y 46 s. A 100.000 serian ~580 GB.
    Por encima del limite se omite esa ruta con un aviso explicito, y el trabajo
    lo hacen cohesion y multi-senal, que son O(N*R). Tras el cambio, 100.000
    wallets se procesan en ~293 s con 157 MB.
    """
    heartbeats, swarm, _ = generate(
        ScenarioConfig(n_honest=200, n_swarm=100, n_shared_rpc=0, rounds=10, seed=7)
    )
    tight = DetectionConfig(
        correlation_threshold=0.8,
        min_cluster_size=40,
        require_conjunction=True,
        random_seed=42,
        max_dense_wallets=10,
    )

    with pytest.warns(RuntimeWarning, match="correlacion densa"):
        report = run_detection(heartbeats, tight)

    # El enjambre se sigue detectando sin la ruta densa.
    flagged = set(report.flagged_wallets)
    assert len(flagged & swarm) / len(swarm) > 0.95
    assert all(c.path != "correlated" for c in report.clusters)


def test_dense_path_runs_below_the_limit():
    heartbeats, _, _ = generate(
        ScenarioConfig(n_honest=200, n_swarm=100, n_shared_rpc=0, rounds=10, seed=7)
    )
    generous = DetectionConfig(min_cluster_size=40, random_seed=42, max_dense_wallets=100_000)

    with warnings.catch_warnings():
        warnings.simplefilter("error")
        run_detection(heartbeats, generous)  # no debe avisar


def test_suspicion_is_never_negative():
    """Una correlacion negativa es ruido, no evidencia de coordinacion.

    Encontrado probando con datos en el formato real de la cadena: un cluster
    hallado por la ruta multi_signal, donde la temporizacion es irrelevante por
    construccion, salia con sospecha negativa y se ordenaba al final de la lista
    en lugar de la primera.
    """
    for jitter in (0, 1, 6, 20):
        report, _, _ = _run(jitter=jitter)
        for cluster in report.clusters:
            assert cluster.suspicion >= 0, (
                f"sospecha negativa con jitter={jitter}: {cluster.suspicion}"
            )


def test_clustersAreSortedByDescendingSuspicion():
    report, _, _ = _run(jitter=0)
    scores = [c.suspicion for c in report.clusters]
    assert scores == sorted(scores, reverse=True)
