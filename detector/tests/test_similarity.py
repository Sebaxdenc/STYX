"""La correlacion es el nucleo del detector: aqui se verifica que mide lo que debe."""

from __future__ import annotations

import numpy as np
import pytest
from scipy.stats import pearsonr

from styx_detector.similarity import (
    distribution_similarity,
    pairwise_correlation,
    zero_variance_groups,
)


def test_correlation_matches_scipy_reference():
    # La implementacion esta vectorizada mediante productos matriciales; hay que
    # comprobarla contra una referencia independiente.
    rng = np.random.default_rng(0)
    data = rng.normal(size=(6, 12))

    corr = pairwise_correlation(data)

    for i in range(6):
        for j in range(6):
            if i == j:
                continue
            expected = pearsonr(data[i], data[j]).statistic
            assert corr[i, j] == pytest.approx(expected, abs=1e-9)


def test_correlation_ignores_absolute_speed():
    """El hallazgo contraintuitivo: Pearson resta la media de cada wallet.

    Dos wallets con el mismo patron pero niveles muy distintos correlacionan a 1.
    Un bot lento no se salva, y un humano rapido no se condena: lo unico que se
    penaliza es moverse en sincronia.
    """
    fast = np.array([[1.0, 2.0, 1.0, 3.0, 1.0, 2.0]])
    slow = fast + 20.0
    corr = pairwise_correlation(np.vstack([fast, slow]))

    assert corr[0, 1] == pytest.approx(1.0)


def test_correlation_is_near_zero_for_independent_series():
    rng = np.random.default_rng(3)
    data = rng.normal(size=(40, 60))
    corr = pairwise_correlation(data)

    off_diagonal = corr[~np.isnan(corr)]
    assert abs(float(np.mean(off_diagonal))) < 0.1


def test_correlation_is_nan_for_zero_variance():
    """Varianza cero hace Pearson indefinido, no cero.

    Devolver cero ahi seria un fallo silencioso: el enjambre mas obvio de todos,
    el que responde siempre en el mismo bloque relativo, pasaria desapercibido.
    """
    constant = np.array([[2.0] * 8, [2.0] * 8])
    corr = pairwise_correlation(constant)

    assert np.isnan(corr[0, 1])


def test_correlation_requires_minimum_overlap():
    a = [1.0, 2.0, 3.0, np.nan, np.nan, np.nan]
    b = [1.0, 2.0, 3.0, np.nan, np.nan, np.nan]
    corr = pairwise_correlation(np.array([a, b]), min_overlap=4)

    assert np.isnan(corr[0, 1]), "tres rondas en comun no bastan para concluir"


def test_correlation_uses_pairwise_complete_observations():
    a = np.array([1.0, 5.0, 2.0, 8.0, 3.0, np.nan])
    b = np.array([1.0, 5.0, 2.0, 8.0, 3.0, 99.0])
    corr = pairwise_correlation(np.vstack([a, b]))

    # La ronda que solo tiene b se descarta, asi que el solape es identico.
    assert corr[0, 1] == pytest.approx(1.0)


def test_zero_variance_groups_catches_constant_responders():
    wallets = ["0xa", "0xb", "0xc"]
    latency = np.array(
        [
            [1.0] * 8,  # constante
            [1.0] * 8,  # constante, mismo valor
            [1.0, 4.0, 2.0, 7.0, 3.0, 5.0, 2.0, 6.0],  # variable
        ]
    )

    groups = zero_variance_groups(latency, wallets)

    assert len(groups) == 1
    assert next(iter(groups.values())) == ["0xa", "0xb"]


def test_zero_variance_groups_separates_different_constants():
    wallets = ["0xa", "0xb"]
    latency = np.array([[1.0] * 8, [3.0] * 8])

    groups = zero_variance_groups(latency, wallets)

    assert len(groups) == 2, "constantes distintas no son el mismo grupo"


def test_distribution_similarity_survives_decorrelation():
    """El jitter rompe la correlacion punto a punto pero no la distribucion."""
    rng = np.random.default_rng(11)
    a = rng.integers(1, 5, size=200).astype(float)
    b = rng.integers(1, 5, size=200).astype(float)

    assert distribution_similarity(a, b) > 0.8

    far = rng.integers(20, 30, size=200).astype(float)
    assert distribution_similarity(a, far) < 0.2
