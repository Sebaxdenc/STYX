from __future__ import annotations

import numpy as np
import pytest

from styx_detector import Heartbeat, build_feature_matrix


def _hb(wallet: str, round_: int, latency: int, **kwargs) -> Heartbeat:
    challenge = 1000 + round_ * 100
    return Heartbeat(
        wallet=wallet,
        cohort=kwargs.pop("cohort", 0),
        round=round_,
        challenge_block=challenge,
        response_block=challenge + latency,
        **kwargs,
    )


def test_latency_is_measured_in_blocks():
    hb = _hb("0xa", 0, 7)
    assert hb.latency == 7


def test_response_before_challenge_is_rejected():
    with pytest.raises(ValueError, match="no puede ser anterior"):
        Heartbeat(wallet="0xa", cohort=0, round=0, challenge_block=100, response_block=100)


def test_matrix_is_ordered_deterministically():
    """El orden no puede depender del orden de llegada: la reproducibilidad del
    informe depende de ello."""
    forward = build_feature_matrix([_hb("0xb", 1, 3), _hb("0xa", 0, 5)])
    backward = build_feature_matrix([_hb("0xa", 0, 5), _hb("0xb", 1, 3)])

    assert forward.wallets == backward.wallets == ["0xa", "0xb"]
    assert forward.rounds == backward.rounds == [0, 1]


def test_missing_rounds_are_nan_not_zero():
    """Cero seria una latencia valida; una ronda sin respuesta debe ser NaN.

    Las columnas son las rondas OBSERVADAS en el dataset, no 0..N: una ronda a la
    que nadie respondio no genera columna.
    """
    # 0xa responde a las rondas 0, 1 y 2; 0xb se salta la 1.
    matrix = build_feature_matrix(
        [_hb("0xa", 0, 4), _hb("0xa", 1, 5), _hb("0xa", 2, 6), _hb("0xb", 0, 3), _hb("0xb", 2, 7)]
    )

    assert matrix.rounds == [0, 1, 2]
    b = matrix.index_of("0xb")
    assert np.isnan(matrix.latency[b, 1]), "la ronda saltada debe ser NaN, no 0"
    assert matrix.latency[b, 0] == 3
    assert matrix.latency[b, 2] == 7


def test_duplicate_response_is_rejected():
    """El contrato impide responder dos veces a la misma ronda; si el indexer
    produce un duplicado, es un error que debe saltar y no promediarse."""
    with pytest.raises(ValueError, match="duplicado"):
        build_feature_matrix([_hb("0xa", 0, 4), _hb("0xa", 0, 9)])


def test_fingerprint_uses_modal_value():
    heartbeats = [
        _hb("0xa", 0, 3, gas_price=100, funder="0xf1"),
        _hb("0xa", 1, 4, gas_price=100, funder="0xf1"),
        _hb("0xa", 2, 5, gas_price=999, funder="0xf1"),
    ]
    matrix = build_feature_matrix(heartbeats)

    assert matrix.fingerprints["0xa"].gas_price == 100


def test_zero_variance_is_visible_in_the_statistics():
    heartbeats = [_hb("0xbot", r, 1) for r in range(8)]
    heartbeats += [_hb("0xhuman", r, 2 + r) for r in range(8)]
    matrix = build_feature_matrix(heartbeats)

    stds = matrix.latency_std()
    bot = matrix.index_of("0xbot")
    human = matrix.index_of("0xhuman")

    assert stds[bot] == 0.0
    assert stds[human] > 0.0


def test_response_counts():
    heartbeats = [_hb("0xa", r, 3) for r in range(5)] + [_hb("0xb", 0, 3)]
    matrix = build_feature_matrix(heartbeats)

    counts = matrix.response_counts()
    assert counts[matrix.index_of("0xa")] == 5
    assert counts[matrix.index_of("0xb")] == 1


def test_empty_input():
    matrix = build_feature_matrix([])
    assert matrix.n_wallets == 0
    assert matrix.n_rounds == 0
