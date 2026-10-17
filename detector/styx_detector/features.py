"""Construccion de la matriz de features a partir de los latidos.

La salida es una matriz wallets x rondas de latencias en bloques, con NaN donde
la wallet no respondio, mas la huella de coincidencia exacta de cada wallet.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

import numpy as np

from .model import Fingerprint, Heartbeat


@dataclass(slots=True)
class FeatureMatrix:
    #: Direcciones, ordenadas. El orden es determinista para que el resultado
    #: sea reproducible por un tercero.
    wallets: list[str]
    #: Rondas presentes en el dataset, ordenadas.
    rounds: list[int]
    #: Latencias en bloques. NaN = sin respuesta.
    latency: np.ndarray
    fingerprints: dict[str, Fingerprint]
    cohorts: dict[str, int]

    @property
    def n_wallets(self) -> int:
        return len(self.wallets)

    @property
    def n_rounds(self) -> int:
        return len(self.rounds)

    def index_of(self, wallet: str) -> int:
        return self.wallets.index(wallet)

    def response_mask(self) -> np.ndarray:
        """True donde hay respuesta."""
        return ~np.isnan(self.latency)

    def response_counts(self) -> np.ndarray:
        return self.response_mask().sum(axis=1)

    def latency_std(self) -> np.ndarray:
        """Desviacion tipica por wallet, ignorando rondas sin respuesta.

        Cero significa latencia constante, que es por si misma anomala: una
        persona no reacciona con regularidad de metronomo.
        """
        with np.errstate(invalid="ignore"):
            return np.nanstd(self.latency, axis=1)

    def latency_mean(self) -> np.ndarray:
        with np.errstate(invalid="ignore"):
            return np.nanmean(self.latency, axis=1)


def build_feature_matrix(heartbeats: list[Heartbeat]) -> FeatureMatrix:
    """Agrupa latidos en una matriz de features.

    El orden de wallets y rondas es lexicografico y numerico respectivamente, no
    el orden de llegada, para que dos ejecuciones sobre el mismo dataset
    produzcan matrices identicas.
    """
    if not heartbeats:
        return FeatureMatrix([], [], np.zeros((0, 0)), {}, {})

    wallets = sorted({hb.wallet for hb in heartbeats})
    rounds = sorted({hb.round for hb in heartbeats})
    w_index = {w: i for i, w in enumerate(wallets)}
    r_index = {r: i for i, r in enumerate(rounds)}

    latency = np.full((len(wallets), len(rounds)), np.nan, dtype=np.float64)
    cohorts: dict[str, int] = {}
    # Se acumulan para tomar el valor modal: una wallet puede variar el gas entre
    # rondas, y la huella debe representar su comportamiento habitual.
    gas_prices: dict[str, Counter[int]] = {}
    gas_limits: dict[str, Counter[int]] = {}
    calldata: dict[str, Counter[str]] = {}
    funders: dict[str, Counter[str]] = {}

    for hb in heartbeats:
        i, j = w_index[hb.wallet], r_index[hb.round]
        if not np.isnan(latency[i, j]):
            raise ValueError(
                f"latido duplicado para {hb.wallet} en la ronda {hb.round}: "
                "el contrato impide responder dos veces a la misma ronda"
            )
        latency[i, j] = float(hb.latency)
        cohorts[hb.wallet] = hb.cohort
        gas_prices.setdefault(hb.wallet, Counter())[hb.gas_price] += 1
        gas_limits.setdefault(hb.wallet, Counter())[hb.gas_limit] += 1
        calldata.setdefault(hb.wallet, Counter())[hb.calldata_hash] += 1
        funders.setdefault(hb.wallet, Counter())[hb.funder] += 1

    fingerprints = {
        w: Fingerprint(
            gas_price=_modal(gas_prices[w]),
            gas_limit=_modal(gas_limits[w]),
            calldata_hash=_modal(calldata[w]),
            funder=_modal(funders[w]),
        )
        for w in wallets
    }

    return FeatureMatrix(wallets, rounds, latency, fingerprints, cohorts)


def _modal(counter: Counter):
    """Valor mas frecuente, desempatando de forma determinista."""
    best_count = max(counter.values())
    return sorted(k for k, v in counter.items() if v == best_count)[0]
