"""Tipos de datos del detector.

Un `Heartbeat` combina lo que emite el evento onchain (participante, cohorte,
ronda, bloques) con senales a nivel de transaccion que el indexer obtiene del
recibo (gas, calldata) y del grafo de fondeo. Ninguna contiene datos personales:
todo es informacion que la cadena ya publica.
"""

from __future__ import annotations

from dataclasses import dataclass, field

FingerprintKey = tuple[int, int, str, str]


@dataclass(frozen=True, slots=True)
class Heartbeat:
    """Una respuesta a un reto, tal como la reconstruye el indexer."""

    wallet: str
    cohort: int
    round: int
    challenge_block: int
    response_block: int
    gas_price: int = 0
    gas_limit: int = 0
    calldata_hash: str = ""
    funder: str = ""

    @property
    def latency(self) -> int:
        """Latencia en bloques. A 300 ms por bloque, un bloque son 300 ms."""
        return self.response_block - self.challenge_block

    def __post_init__(self) -> None:
        if self.response_block <= self.challenge_block:
            raise ValueError(
                f"respuesta en el bloque {self.response_block} no puede ser anterior o igual "
                f"al reto en {self.challenge_block}"
            )


@dataclass(frozen=True, slots=True)
class Fingerprint:
    """Senales de coincidencia exacta de una wallet.

    Son las que satisfacen el requisito de conjuncion del invariante 12: la
    correlacion sola produce falsos positivos cuando usuarios honestos comparten
    un RPC publico.
    """

    gas_price: int
    gas_limit: int
    calldata_hash: str
    funder: str

    def key(self) -> FingerprintKey:
        return (self.gas_price, self.gas_limit, self.calldata_hash, self.funder)


@dataclass(slots=True)
class Cluster:
    """Un grupo de wallets que el detector considera coordinado."""

    cluster_id: int
    members: list[str]
    #: Ruta por la que se detecto: "identical" (varianza cero) o "correlated".
    path: str
    mean_internal_correlation: float
    density: float
    #: Fraccion de miembros que comparten la huella modal del cluster.
    conjunction_share: float
    conjunction_signals: list[str] = field(default_factory=list)
    suspicion: float = 0.0

    @property
    def size(self) -> int:
        return len(self.members)


@dataclass(slots=True)
class Report:
    """Salida del detector, publicable y recomputable por un tercero."""

    clusters: list[Cluster]
    wallet_count: int
    round_count: int
    #: Wallets no asignadas a ningun cluster.
    unclustered: list[str]
    merkle_root: str
    params_digest: str

    @property
    def flagged_wallets(self) -> list[str]:
        out: list[str] = []
        for c in self.clusters:
            out.extend(c.members)
        return sorted(out)
