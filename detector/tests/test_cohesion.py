"""Tests de la ruta de factor latente, que es la que aguanta el jitter."""

from __future__ import annotations

import numpy as np
import pytest

from styx_detector import Heartbeat, build_feature_matrix
from styx_detector.cohesion import candidate_groups, expected_null_cohesion, group_cohesion


def _matrix(latencies: dict[str, list[float | None]], **fingerprint):
    heartbeats = []
    for wallet, series in latencies.items():
        for r, latency in enumerate(series):
            if latency is None:
                continue
            heartbeats.append(
                Heartbeat(
                    wallet=wallet,
                    cohort=0,
                    round=r,
                    challenge_block=1000 + r * 100,
                    response_block=1000 + r * 100 + int(latency),
                    **fingerprint,
                )
            )
    return build_feature_matrix(heartbeats)


def test_cohesion_is_high_for_a_shared_latent_factor():
    # Todos siguen el mismo patron de carga, con desplazamientos distintos.
    shared = [1, 1, 4, 1, 2, 6, 1, 3]
    matrix = _matrix(
        {f"0x{i:040x}": [v + i for v in shared] for i in range(10)},
        funder="0xf",
    )

    cohesion = group_cohesion(matrix, matrix.wallets)
    assert cohesion > 0.95


def test_cohesion_is_low_for_independent_wallets():
    rng = np.random.default_rng(4)
    matrix = _matrix(
        {f"0x{i:040x}": list(rng.integers(2, 15, size=12).astype(float)) for i in range(30)},
        funder="0xf",
    )

    cohesion = group_cohesion(matrix, matrix.wallets)
    assert abs(cohesion) < 0.3


def test_cohesion_survives_jitter_that_destroys_pairwise_correlation():
    """El resultado que justifica la existencia de este modulo.

    Con jitter moderado la correlacion entre dos wallets cae por debajo de
    cualquier umbral util, pero el perfil del grupo promedia el ruido y el factor
    compartido reaparece.
    """
    rng = np.random.default_rng(9)
    shared = np.array([1, 1, 5, 1, 2, 7, 1, 3, 2, 6], dtype=float)

    series = {}
    for i in range(60):
        # Jitter 0..8. Con var(compartida) ~4,7 y var(jitter) ~6,7, la
        # correlacion por pares esperada es 4,7/(4,7+6,7) = 0,41, y la cohesion
        # de grupo sqrt(0,41) = 0,64.
        noise = rng.integers(0, 9, size=shared.size)
        series[f"0x{i:040x}"] = list(shared + noise)

    matrix = _matrix(series, funder="0xf")

    from styx_detector.similarity import pairwise_correlation

    corr = pairwise_correlation(matrix.latency)
    mean_pairwise = float(np.nanmean(corr))
    cohesion = group_cohesion(matrix, matrix.wallets)

    assert mean_pairwise < 0.8, "la correlacion por pares no deberia bastar aqui"
    assert cohesion > mean_pairwise, "la cohesion de grupo debe ser mas sensible"
    assert cohesion > 0.5


def test_cohesion_uses_leave_one_out():
    """Sin dejar fuera al miembro, correlacionaria con un perfil que lo contiene
    y la cohesion saldria inflada, sobre todo en grupos pequenos."""
    # Un unico miembro con patron propio dentro de un grupo independiente.
    rng = np.random.default_rng(2)
    series = {f"0x{i:040x}": list(rng.integers(2, 15, size=12).astype(float)) for i in range(4)}
    matrix = _matrix(series, funder="0xf")

    cohesion = group_cohesion(matrix, matrix.wallets)
    # Con solo cuatro wallets independientes el valor debe seguir siendo bajo.
    assert cohesion < 0.6


def test_cohesion_requires_minimum_overlap():
    matrix = _matrix({"0xa": [3, 4, None, None], "0xb": [3, 4, None, None]}, funder="0xf")
    assert group_cohesion(matrix, matrix.wallets, min_overlap=4) == 0.0


def test_cohesion_of_a_single_wallet_is_zero():
    matrix = _matrix({"0xa": [3, 4, 5, 6]}, funder="0xf")
    assert group_cohesion(matrix, ["0xa"]) == 0.0


def test_null_cohesion_decays_as_one_over_sqrt_n():
    assert expected_null_cohesion(2) == pytest.approx(1.0)
    assert expected_null_cohesion(101) == pytest.approx(0.1)
    assert expected_null_cohesion(1) == 1.0


def test_candidate_groups_partition_by_each_signal_separately():
    """Un enjambre que varie el gas puede seguir delatandose por el financiador."""
    heartbeats = []
    for i in range(10):
        for r in range(5):
            heartbeats.append(
                Heartbeat(
                    wallet=f"0x{i:040x}",
                    cohort=0,
                    round=r,
                    challenge_block=1000 + r * 100,
                    response_block=1000 + r * 100 + 3,
                    gas_price=i,  # distinto para cada wallet
                    gas_limit=90_000,  # compartido
                    calldata_hash=f"0x{i}",  # distinto
                    funder="0xcommon",  # compartido
                )
            )
    matrix = build_feature_matrix(heartbeats)

    groups = candidate_groups(matrix, min_size=5)
    fields = {field for field, _ in groups}

    assert "funder" in fields
    assert "gas_limit" in fields
    assert "gas_price" not in fields, "el gas varia por wallet, no debe agrupar"


def test_candidate_groups_ignore_empty_and_zero_values():
    heartbeats = [
        Heartbeat(
            wallet=f"0x{i:040x}",
            cohort=0,
            round=r,
            challenge_block=1000 + r * 100,
            response_block=1000 + r * 100 + 3,
        )
        for i in range(10)
        for r in range(5)
    ]
    matrix = build_feature_matrix(heartbeats)

    # Sin huellas: un valor vacio o cero no es evidencia de nada.
    assert candidate_groups(matrix, min_size=5) == {}
