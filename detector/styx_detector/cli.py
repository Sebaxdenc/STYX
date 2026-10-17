"""Interfaz de linea de comandos del detector.

    python -m styx_detector simulate --out data/heartbeats.json
    python -m styx_detector detect --input data/heartbeats.json --out data/report.json

El informe de salida es lo que se publica por CID y se compromete en la cadena.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from .commitment import cluster_proofs
from .model import Heartbeat
from .params import load_config
from .pipeline import run_detection
from .simulate import ScenarioConfig, generate


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="styx_detector", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sim = sub.add_parser("simulate", help="genera un dataset sintetico")
    sim.add_argument("--out", type=Path, required=True)
    sim.add_argument("--honest", type=int, default=400)
    sim.add_argument("--swarm", type=int, default=120)
    sim.add_argument("--shared-rpc", type=int, default=80)
    sim.add_argument("--rounds", type=int, default=10)
    sim.add_argument("--jitter", type=int, default=0, help="0 produce vectores identicos")
    sim.add_argument("--seed", type=int, default=7)

    det = sub.add_parser("detect", help="ejecuta la deteccion sobre un dataset")
    det.add_argument("--input", type=Path, required=True)
    det.add_argument("--out", type=Path)
    det.add_argument("--params", type=Path, default=None)

    args = parser.parse_args(argv)

    if args.command == "simulate":
        return _simulate(args)
    return _detect(args)


def _simulate(args) -> int:
    heartbeats, swarm, shared_rpc = generate(
        ScenarioConfig(
            n_honest=args.honest,
            n_swarm=args.swarm,
            n_shared_rpc=args.shared_rpc,
            rounds=args.rounds,
            swarm_jitter=args.jitter,
            seed=args.seed,
        )
    )
    payload = {
        "heartbeats": [asdict(hb) for hb in heartbeats],
        "ground_truth": {"swarm": sorted(swarm), "shared_rpc": sorted(shared_rpc)},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(f"latidos generados : {len(heartbeats)}")
    print(f"enjambre          : {len(swarm)} wallets")
    print(f"honestos (RPC)    : {len(shared_rpc)} wallets")
    print(f"escrito en        : {args.out}")
    return 0


def _detect(args) -> int:
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    heartbeats = [Heartbeat(**row) for row in payload["heartbeats"]]
    config, params_used = load_config(args.params)

    report = run_detection(heartbeats, config, params_used)

    print(f"wallets analizadas : {report.wallet_count}")
    print(f"rondas             : {report.round_count}")
    print(f"clusters hallados  : {len(report.clusters)}")
    for cluster in report.clusters:
        print(
            f"  cluster {cluster.cluster_id}: {cluster.size} wallets"
            f" | ruta {cluster.path}"
            f" | corr {cluster.mean_internal_correlation:.3f}"
            f" | densidad {cluster.density:.3f}"
            f" | sospecha {cluster.suspicion:.3f}"
            f" | senales {','.join(cluster.conjunction_signals) or 'ninguna'}"
        )
    print(f"marcadas           : {len(report.flagged_wallets)}")
    print(f"raiz Merkle        : {report.merkle_root}")
    print(f"huella del ruleset : {report.params_digest}")

    truth = payload.get("ground_truth")
    if truth:
        _print_accuracy(report, truth)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        assignments = [(w, c.cluster_id) for c in report.clusters for w in c.members]
        args.out.write_text(
            json.dumps(
                {
                    "merkle_root": report.merkle_root,
                    "params_digest": report.params_digest,
                    "wallet_count": report.wallet_count,
                    "round_count": report.round_count,
                    "clusters": [asdict(c) for c in report.clusters],
                    # Sin las pruebas el compromiso onchain es inutil: markFlagged
                    # las exige, y sin marcar no hay revocacion.
                    "proofs": cluster_proofs(sorted(assignments)),
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"informe escrito en : {args.out}")
        print(f"pruebas incluidas  : {len(report.flagged_wallets)}")

    return 0


def _print_accuracy(report, truth: dict) -> None:
    flagged = set(report.flagged_wallets)
    swarm = set(truth.get("swarm", []))
    shared_rpc = set(truth.get("shared_rpc", []))

    caught = len(flagged & swarm)
    false_positives = len(flagged - swarm)

    print("--- contraste con la verdad conocida ---")
    print(f"enjambre detectado        : {caught}/{len(swarm)}")
    print(f"falsos positivos          : {false_positives}")
    print(f"  de los que comparten RPC: {len(flagged & shared_rpc)}")


if __name__ == "__main__":
    sys.exit(main())
