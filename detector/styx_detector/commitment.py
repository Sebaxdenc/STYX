"""Compromiso onchain del resultado.

El detector corre fuera de la cadena y publica dentro solo una raiz Merkle mas
el CID del ruleset y del dataset. Es el patron opML: inferencia fuera,
verificacion optimista dentro, con ventana de impugnacion.

Las hojas y los nodos usan keccak256 con pares ordenados, compatible con
`MerkleProof` de OpenZeppelin, para que una impugnacion pueda probar la
pertenencia de una wallet a un cluster directamente en Solidity.
"""

from __future__ import annotations

import json

from Crypto.Hash import keccak

ZERO_ROOT = "0x" + "00" * 32


def keccak256(data: bytes) -> bytes:
    digest = keccak.new(digest_bits=256)
    digest.update(data)
    return digest.digest()


def leaf_hash(wallet: str, cluster_id: int) -> bytes:
    """keccak256(abi.encodePacked(address wallet, uint256 clusterId))."""
    address = bytes.fromhex(wallet.lower().removeprefix("0x").rjust(40, "0"))
    if len(address) != 20:
        raise ValueError(f"direccion invalida: {wallet}")
    if cluster_id < 0 or cluster_id >= 2**256:
        raise ValueError(f"clusterId fuera de rango: {cluster_id}")
    return keccak256(address + cluster_id.to_bytes(32, "big"))


def merkle_root(leaves: list[bytes]) -> str:
    """Raiz Merkle con pares ordenados.

    Las hojas se ordenan antes de construir el arbol, de modo que la raiz no
    depende del orden en que el detector descubrio los clusters. Esa es la
    propiedad que hace el resultado reproducible por un tercero.
    """
    if not leaves:
        return ZERO_ROOT

    level = sorted(set(leaves))
    while len(level) > 1:
        nxt: list[bytes] = []
        for i in range(0, len(level) - 1, 2):
            a, b = level[i], level[i + 1]
            nxt.append(keccak256(a + b if a <= b else b + a))
        if len(level) % 2 == 1:
            # Nodo impar: se promociona sin hashear, como en OpenZeppelin.
            nxt.append(level[-1])
        level = nxt

    return "0x" + level[0].hex()


def cluster_merkle_root(assignments: list[tuple[str, int]]) -> str:
    """Raiz sobre los pares (wallet, clusterId) de un informe."""
    return merkle_root([leaf_hash(w, c) for w, c in assignments])


def params_digest(params: dict) -> str:
    """Huella del ruleset exacto con el que se produjo un informe.

    Permite demostrar que las reglas publicadas antes de abrir la venta son las
    que realmente se aplicaron.
    """
    canonical = json.dumps(params, sort_keys=True, separators=(",", ":"))
    return "0x" + keccak256(canonical.encode()).hex()


def merkle_proof(leaves: list[bytes], target: bytes) -> list[str]:
    """Prueba de pertenencia de `target`, compatible con pares ordenados.

    Sin esto el compromiso onchain es inutil en la practica: `markFlagged` exige
    una prueba, y sin prueba nadie puede marcar una wallet ni revocar su entrada.

    La construccion debe replicar exactamente la de `merkle_root`, incluida la
    promocion del nodo impar sin hashear. Si divergen, la prueba no valida.
    """
    level = sorted(set(leaves))
    if target not in level:
        raise ValueError("la hoja no esta en el arbol")

    index = level.index(target)
    proof: list[bytes] = []

    while len(level) > 1:
        nxt: list[bytes] = []
        next_index = index

        for i in range(0, len(level) - 1, 2):
            a, b = level[i], level[i + 1]
            nxt.append(keccak256(a + b if a <= b else b + a))
            if i == index:
                proof.append(b)
                next_index = len(nxt) - 1
            elif i + 1 == index:
                proof.append(a)
                next_index = len(nxt) - 1

        if len(level) % 2 == 1:
            # Nodo impar promocionado sin hashear: no tiene hermano en este nivel.
            nxt.append(level[-1])
            if index == len(level) - 1:
                next_index = len(nxt) - 1

        level = nxt
        index = next_index

    return ["0x" + node.hex() for node in proof]


def verify_proof(leaf: bytes, proof: list[str], root: str) -> bool:
    """Verificacion equivalente a la de `ClusterRegistry._verify` en Solidity.

    Existe para que los tests puedan comprobar el ida y vuelta sin desplegar
    nada: si esta funcion y el contrato divergen, el compromiso deja de ser
    verificable y la deteccion no tiene consecuencias.
    """
    computed = leaf
    for step in proof:
        sibling = bytes.fromhex(step.removeprefix("0x"))
        computed = keccak256(
            computed + sibling if computed <= sibling else sibling + computed
        )
    return "0x" + computed.hex() == root


def cluster_proofs(assignments: list[tuple[str, int]]) -> dict[str, dict]:
    """Prueba por wallet, lista para pasarsela a `markFlagged`."""
    leaves = [leaf_hash(w, c) for w, c in assignments]
    out: dict[str, dict] = {}
    for wallet, cluster_id in assignments:
        out[wallet] = {
            "clusterId": cluster_id,
            "proof": merkle_proof(leaves, leaf_hash(wallet, cluster_id)),
        }
    return out
