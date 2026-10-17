"""Similitud entre wallets.

La metrica principal es la correlacion de Pearson entre vectores de latencia. Lo
importante, y lo contraintuitivo, es que Pearson resta primero la media de cada
wallet: por tanto NO mide "son rapidos", mide "se mueven juntos". Un bot lento no
se salva y un humano rapido no se condena. Solo se penaliza moverse en sincronia
con otros, que es lo que no se puede hacer sin coordinacion real.

Ver ARCHITECTURE.md seccion 3.
"""

from __future__ import annotations

import numpy as np


def pairwise_correlation(latency: np.ndarray, min_overlap: int = 4) -> np.ndarray:
    """Matriz de correlacion de Pearson con observaciones completas por pares.

    Vectorizada mediante cuatro productos matriciales en lugar de un bucle sobre
    pares, que seria intratable: con N wallets hay N(N-1)/2 pares.

    Devuelve NaN cuando el solape entre dos wallets es insuficiente o cuando
    alguna de las dos tiene varianza cero en el solape. La varianza cero no se
    ignora: la trata `zero_variance_groups`, porque un vector constante es una
    senal fuerte por si misma y Pearson es indefinido ahi.
    """
    n_wallets, _ = latency.shape
    if n_wallets == 0:
        return np.zeros((0, 0))

    mask = (~np.isnan(latency)).astype(np.float64)
    x = np.nan_to_num(latency, nan=0.0)

    # Estadisticos restringidos al solape de cada par.
    n = mask @ mask.T
    sum_x = x @ mask.T
    sum_y = sum_x.T
    sum_xy = x @ x.T
    sum_xx = (x * x) @ mask.T
    sum_yy = sum_xx.T

    with np.errstate(invalid="ignore", divide="ignore"):
        numerator = n * sum_xy - sum_x * sum_y
        var_x = n * sum_xx - sum_x * sum_x
        var_y = n * sum_yy - sum_y * sum_y
        denominator = np.sqrt(var_x * var_y)
        corr = numerator / denominator

    corr[n < min_overlap] = np.nan
    # La varianza nula hace el denominador cero: indefinido, no cero.
    corr[denominator <= 0] = np.nan
    np.fill_diagonal(corr, np.nan)

    return np.clip(corr, -1.0, 1.0)


def zero_variance_groups(
    latency: np.ndarray, wallets: list[str], min_responses: int = 4
) -> dict[tuple, list[str]]:
    """Agrupa wallets cuyo vector de latencia es constante, por su valor.

    Esta es la ruta que captura al adversario perezoso. Si diez mil wallets
    responden siempre exactamente en el mismo bloque relativo, su varianza es
    cero, Pearson no puede evaluarlas y el camino de correlacion las dejaria
    pasar. Agruparlas por su constante las delata de inmediato.

    La clave incluye que rondas respondio cada wallet, de modo que no se agrupan
    wallets que coinciden en el valor pero participaron en rondas distintas.
    """
    groups: dict[tuple, list[str]] = {}
    mask = ~np.isnan(latency)

    for i, wallet in enumerate(wallets):
        row = latency[i]
        present = mask[i]
        if present.sum() < min_responses:
            continue
        values = row[present]
        if np.nanstd(values) > 0:
            continue
        key = (float(values[0]), tuple(np.flatnonzero(present).tolist()))
        groups.setdefault(key, []).append(wallet)

    return {k: sorted(v) for k, v in groups.items()}


def distribution_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Similitud de distribuciones mediante Kolmogorov-Smirnov de dos muestras.

    Sobrevive al jitter: un adversario que anade ruido aleatorio por wallet rompe
    la correlacion punto a punto, pero si el ruido se genera en infraestructura
    compartida la distribucion sigue siendo comun. Devuelve 1 - estadistico, de
    modo que 1 es identico y 0 completamente distinto.
    """
    from scipy.stats import ks_2samp

    a_clean = a[~np.isnan(a)]
    b_clean = b[~np.isnan(b)]
    if a_clean.size < 2 or b_clean.size < 2:
        return 0.0
    statistic = ks_2samp(a_clean, b_clean).statistic
    return float(1.0 - statistic)
