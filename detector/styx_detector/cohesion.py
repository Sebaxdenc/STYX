"""Deteccion por factor latente compartido.

Esta ruta existe porque la correlacion por pares NO aguanta el jitter. Si el
enjambre anade ruido aleatorio por wallet, la correlacion entre dos de sus
wallets cae a

    var_compartida / (var_compartida + var_jitter)

que con jitter moderado baja de 0,6 y se escapa de cualquier umbral razonable.
Bajar el umbral no es opcion: dispararia los falsos positivos.

La solucion es dejar de mirar pares y mirar el GRUPO. Si n wallets comparten un
factor latente, el perfil medio del grupo estima ese factor con un ruido
reducido en un factor sqrt(n). Entonces la correlacion de cada miembro contra el
perfil es

    sqrt(var_compartida / (var_compartida + var_jitter))

que con los mismos numeros sube a ~0,78, y lo que es mas importante: la
separacion frente al caso independiente es enorme, porque un grupo de wallets
independientes da una cohesion de aproximadamente 1/sqrt(n).

El orden de las operaciones es deliberado. Primero se parte la poblacion por
senales de coincidencia exacta, que es O(N) y baratisimo, y solo despues se mide
la cohesion. Eso satisface el invariante 12 por construccion y de paso resuelve
el coste: usuarios honestos que comparten un RPC publico comparten factor
latente, pero no comparten financiador ni parametros de gas, asi que nunca
llegan a formar grupo candidato.
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np

from .features import FeatureMatrix

#: Campos de la huella por los que se parte la poblacion en grupos candidatos.
PARTITION_FIELDS = ("funder", "calldata_hash", "gas_price", "gas_limit")


def candidate_groups(matrix: FeatureMatrix, min_size: int) -> dict[tuple[str, object], list[str]]:
    """Agrupa wallets por cada senal de coincidencia exacta, por separado.

    Se evalua cada campo de forma independiente a proposito: un enjambre que
    varie el gas puede seguir delatandose por el financiador comun, y al
    contrario.
    """
    groups: dict[tuple[str, object], list[str]] = defaultdict(list)

    for wallet in matrix.wallets:
        fingerprint = matrix.fingerprints.get(wallet)
        if fingerprint is None:
            continue
        for field in PARTITION_FIELDS:
            value = getattr(fingerprint, field)
            if value in ("", 0, None):
                continue
            groups[(field, value)].append(wallet)

    return {k: sorted(v) for k, v in groups.items() if len(v) >= min_size}


def group_cohesion(matrix: FeatureMatrix, members: list[str], min_overlap: int = 4) -> float:
    """Correlacion media de cada miembro contra el perfil del grupo.

    Se calcula dejando fuera al propio miembro al construir el perfil
    (leave-one-out). Sin eso, un miembro correlacionaria con un perfil que lo
    contiene y la cohesion saldria inflada, sobre todo en grupos pequenos.

    Valores de referencia: un grupo coordinado con jitter moderado ronda 0,7 u
    0,8; un grupo de wallets independientes ronda 1/sqrt(n), es decir 0,1 para
    cien miembros.
    """
    if len(members) < 2:
        return 0.0

    idx = [matrix.index_of(w) for w in members]
    latency = matrix.latency[idx, :]

    # Desviaciones respecto a la media de cada wallet: igual que en Pearson, el
    # nivel absoluto se elimina. No se mide "son rapidos", se mide si se mueven
    # juntos.
    with np.errstate(invalid="ignore"):
        means = np.nanmean(latency, axis=1, keepdims=True)
    deviations = latency - means

    present = ~np.isnan(deviations)
    filled = np.nan_to_num(deviations, nan=0.0)

    column_sum = filled.sum(axis=0)
    column_count = present.sum(axis=0)

    correlations: list[float] = []
    for row in range(len(members)):
        mask = present[row]
        if mask.sum() < min_overlap:
            continue

        # Perfil del grupo sin este miembro.
        others_sum = column_sum - filled[row]
        others_count = column_count - mask.astype(int)
        valid = mask & (others_count > 0)
        if valid.sum() < min_overlap:
            continue

        profile = others_sum[valid] / others_count[valid]
        member = deviations[row][valid]

        if np.std(profile) == 0 or np.std(member) == 0:
            # Varianza nula: la trata la ruta de vectores identicos.
            continue

        correlations.append(float(np.corrcoef(member, profile)[0, 1]))

    if not correlations:
        return 0.0
    return float(np.mean(correlations))


def expected_null_cohesion(group_size: int) -> float:
    """Cohesion esperada para un grupo de wallets independientes.

    Un miembro correlaciona con el perfil de n-1 companeros independientes en
    torno a 1/sqrt(n-1), por puro azar de muestreo. Sirve de linea base para
    interpretar una cohesion observada.
    """
    if group_size < 2:
        return 1.0
    return 1.0 / np.sqrt(group_size - 1)
