from __future__ import annotations

import pytest

from styx_detector.commitment import (
    ZERO_ROOT,
    cluster_merkle_root,
    keccak256,
    leaf_hash,
    merkle_root,
    params_digest,
)


def test_keccak256_matches_the_known_empty_string_digest():
    # Valor canonico de keccak256(""), el mismo que usa Solidity.
    assert keccak256(b"").hex() == (
        "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    )


def test_leaf_hash_matches_solidity():
    """Vector de referencia calculado con `cast keccak` de Foundry.

    Esta igualdad es la que permite que una impugnacion pruebe la pertenencia de
    una wallet a un cluster directamente en un contrato. Si se rompe, el
    compromiso onchain deja de ser verificable.

        cast keccak 0x1111111111111111111111111111111111111111\\
                    0000000000000000000000000000000000000000000000000000000000000003
    """
    expected = "0x7f98630d348c602ff8dda5d6aebb251d7bfd1b8510a6faa433a6ec76b06ffdb8"
    actual = "0x" + leaf_hash("0x1111111111111111111111111111111111111111", 3).hex()

    assert actual == expected


def test_leaf_hash_is_case_insensitive_and_accepts_bare_hex():
    a = leaf_hash("0xAABBCCDDEEFF00112233445566778899AABBCCDD", 1)
    b = leaf_hash("aabbccddeeff00112233445566778899aabbccdd", 1)

    assert a == b


def test_leaf_hash_rejects_malformed_address():
    with pytest.raises(ValueError, match="direccion invalida"):
        leaf_hash("0x" + "ff" * 25, 0)


def test_empty_tree_is_the_zero_root():
    assert merkle_root([]) == ZERO_ROOT
    assert cluster_merkle_root([]) == ZERO_ROOT


def test_single_leaf_tree_is_that_leaf():
    leaf = leaf_hash("0x" + "01" * 20, 0)
    assert merkle_root([leaf]) == "0x" + leaf.hex()


def test_root_does_not_depend_on_input_order():
    """La raiz debe depender del conjunto, no del orden en que el detector
    descubrio los clusters. Es lo que hace el informe reproducible."""
    a = ("0x" + "0a" * 20, 0)
    b = ("0x" + "0b" * 20, 0)
    c = ("0x" + "0c" * 20, 1)

    assert cluster_merkle_root([a, b, c]) == cluster_merkle_root([c, a, b])


def test_root_changes_when_an_assignment_changes():
    base = [("0x" + "0a" * 20, 0), ("0x" + "0b" * 20, 0)]
    moved = [("0x" + "0a" * 20, 0), ("0x" + "0b" * 20, 1)]

    assert cluster_merkle_root(base) != cluster_merkle_root(moved)


def test_root_is_stable_across_runs():
    assignments = [(f"0x{i:040x}", i % 3) for i in range(17)]
    assert cluster_merkle_root(assignments) == cluster_merkle_root(assignments)


def test_odd_leaf_count_is_handled():
    # Numero impar en varios niveles del arbol.
    for count in (3, 5, 7, 9, 11):
        assignments = [(f"0x{i:040x}", 0) for i in range(count)]
        root = cluster_merkle_root(assignments)
        assert root != ZERO_ROOT
        assert len(root) == 66


def test_params_digest_is_order_independent_but_value_sensitive():
    a = params_digest({"x": 1, "y": 2})
    b = params_digest({"y": 2, "x": 1})
    c = params_digest({"x": 1, "y": 3})

    assert a == b, "el orden de las claves no debe cambiar la huella"
    assert a != c, "un valor distinto debe cambiar la huella"
