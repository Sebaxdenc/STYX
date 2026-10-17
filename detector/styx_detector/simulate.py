"""Generador de datasets sinteticos.

Sirve para dos cosas: la demo, que necesita cien mil participantes antes de que
exista un despliegue real, y los tests, que deben verificar que el detector caza
al adversario y que NO acusa a usuarios honestos.

El modelo del enjambre es lo importante. Sus latencias comparten un componente
por ronda, que representa la carga de la maquina que lo orquesta o el camino de
red comun. Ese componente compartido es exactamente lo que detecta la
correlacion, y es lo que un operador no puede eliminar sin dejar de compartir
infraestructura.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .model import Heartbeat

SWARM_FUNDER = "0x" + "11" * 20
SWARM_CALLDATA = "0x" + "ab" * 32
SWARM_GAS_PRICE = 50_000_000_000
SWARM_GAS_LIMIT = 90_000


@dataclass(slots=True)
class ScenarioConfig:
    n_honest: int = 400
    n_swarm: int = 120
    #: Honestos que comparten un mismo pico de carga, por usar el mismo RPC
    #: publico. Deben quedar SIN marcar: tienen financiadores y gas distintos.
    n_shared_rpc: int = 80
    rounds: int = 10
    response_window: int = 33
    #: 0 produce vectores identicos; > 0 descorrelaciona parcialmente.
    swarm_jitter: int = 0
    #: Adversario cuidadoso: ademas de jitter, aleatoriza financiador, gas y
    #: calldata. Escapa de la deteccion, y existe para documentar ese limite.
    swarm_randomize_fingerprints: bool = False
    #: Probabilidad de que un honesto pierda una ronda.
    honest_miss_rate: float = 0.08
    seed: int = 7


def generate(config: ScenarioConfig) -> tuple[list[Heartbeat], set[str], set[str]]:
    """Genera latidos.

    Devuelve los latidos, el conjunto de wallets del enjambre y el conjunto de
    honestos que comparten RPC, para que los tests puedan comprobar aciertos y
    falsos positivos por separado.
    """
    rng = np.random.default_rng(config.seed)
    heartbeats: list[Heartbeat] = []

    challenge_blocks = [1000 + r * 100 + int(rng.integers(1, 60)) for r in range(config.rounds)]

    # ---- Honestos independientes -------------------------------------------
    honest: set[str] = set()
    for i in range(config.n_honest):
        wallet = _address(0x1000 + i)
        honest.add(wallet)
        funder = _address(0x900000 + i)  # cada uno con su propia procedencia
        gas_price = int(rng.integers(40, 70)) * 1_000_000_000
        for r in range(config.rounds):
            if rng.random() < config.honest_miss_rate:
                continue
            latency = _human_latency(rng, config.response_window)
            heartbeats.append(
                Heartbeat(
                    wallet=wallet,
                    cohort=0,
                    round=r,
                    challenge_block=challenge_blocks[r],
                    response_block=challenge_blocks[r] + latency,
                    gas_price=gas_price,
                    gas_limit=int(rng.integers(80, 120)) * 1000,
                    calldata_hash=_address(0x700000 + i * 7 + r),
                    funder=funder,
                )
            )

    # ---- Enjambre: un solo reloj -------------------------------------------
    # Perturbacion compartida por ronda: la maquina orquestadora se atasca y
    # TODAS sus wallets se retrasan a la vez.
    shared = rng.choice([0, 0, 0, 1, 2, 4], size=config.rounds)
    swarm: set[str] = set()
    for i in range(config.n_swarm):
        wallet = _address(0x500000 + i)
        swarm.add(wallet)
        for r in range(config.rounds):
            latency = 1 + int(shared[r])
            if config.swarm_jitter > 0:
                latency += int(rng.integers(0, config.swarm_jitter + 1))
            latency = max(1, min(latency, config.response_window))
            if config.swarm_randomize_fingerprints:
                gas_price = int(rng.integers(40, 70)) * 1_000_000_000
                gas_limit = int(rng.integers(80, 120)) * 1000
                calldata = _address(0x600000 + i * 13 + r)
                funder = _address(0x960000 + i)
            else:
                gas_price = SWARM_GAS_PRICE
                gas_limit = SWARM_GAS_LIMIT
                calldata = SWARM_CALLDATA
                funder = SWARM_FUNDER
            heartbeats.append(
                Heartbeat(
                    wallet=wallet,
                    cohort=0,
                    round=r,
                    challenge_block=challenge_blocks[r],
                    response_block=challenge_blocks[r] + latency,
                    gas_price=gas_price,
                    gas_limit=gas_limit,
                    calldata_hash=calldata,
                    funder=funder,
                )
            )

    # ---- Honestos que comparten RPC ----------------------------------------
    # Comparten el patron de carga, igual que el enjambre, pero no comparten
    # ninguna senal exacta. El requisito de conjuncion debe salvarlos.
    shared_rpc: set[str] = set()
    rpc_load = rng.choice([0, 0, 1, 3, 6], size=config.rounds)
    for i in range(config.n_shared_rpc):
        wallet = _address(0x300000 + i)
        shared_rpc.add(wallet)
        funder = _address(0x950000 + i)
        for r in range(config.rounds):
            if rng.random() < config.honest_miss_rate:
                continue
            latency = _human_latency(rng, config.response_window) + int(rpc_load[r])
            latency = max(1, min(latency, config.response_window))
            heartbeats.append(
                Heartbeat(
                    wallet=wallet,
                    cohort=0,
                    round=r,
                    challenge_block=challenge_blocks[r],
                    response_block=challenge_blocks[r] + latency,
                    gas_price=int(rng.integers(40, 70)) * 1_000_000_000,
                    gas_limit=int(rng.integers(80, 120)) * 1000,
                    calldata_hash=_address(0x800000 + i * 11 + r),
                    funder=funder,
                )
            )

    return heartbeats, swarm, shared_rpc


def _human_latency(rng: np.random.Generator, response_window: int) -> int:
    """Reaccion humana: dispersa y asimetrica.

    Centrada en torno a 1,5 s (5 bloques a 300 ms) con cola larga, que es la
    razon por la que la ventana de respuesta es ancha: una ventana estrecha
    censuraria esta cola, que es justo la senal que se quiere medir.
    """
    value = int(round(rng.lognormal(mean=1.5, sigma=0.55)))
    return max(2, min(value, response_window))


def _address(n: int) -> str:
    return "0x" + n.to_bytes(20, "big").hex()
