"""Freeze a post-hoc opaque-identifier probe; never call it a new held-out test."""

import argparse
from copy import deepcopy
import json
from pathlib import Path

from recovery_dataset import DATA, ROOT, load_frozen, write_rows
from liftcut_agent.interactive import digest, validate_scenarios
from liftcut_agent.benchmark import load_catalog
from server_workspace import dump_new, sha256

PROBE = ROOT / "benchmark/recovery-identifier-probe-v1"


def blind(scenario):
    result = deepcopy(scenario)
    for record in result["input"]["records"]:
        record["id"] = "record-" + digest({"probe": "opaque-v1", "source_id": record["id"]})[:12]
    for memory in result["memories"]:
        memory["id"] = "memory-" + digest({"probe": "opaque-v1", "source_id": memory["id"]})[:12]
    return result


def identifier_hints(scenario):
    identifiers = [r["id"] for r in scenario["input"]["records"]] + [m["id"] for m in scenario["memories"]]
    hints = {"approved", "revoked", "pending", "declined", "infeasible", "partial_clarification", "memory_supersession", "preview"}
    return [identity for identity in identifiers if any(hint in identity.lower() for hint in hints)]


def freeze(output):
    if output.exists():
        raise ValueError("probe output already exists")
    original = load_frozen()
    rows = [blind(row) for row in original]
    validate_scenarios(rows, load_catalog(ROOT / "benchmark/catalog.json"))
    if any(identifier_hints(row) for row in rows):
        raise ValueError("semantic category leaked into agent-visible identifiers")
    for split in ("train", "dev", "test"):
        write_rows(output / f"{split}.jsonl", [r for r in rows if r["split"] == split])
    dump_new(output / "manifest.json", {"version": "recovery-identifier-probe-v1",
        "scope": "Post-hoc identifier robustness diagnostic; same tasks; not a new held-out test or corrected-training study",
        "original_manifest_sha256": sha256(DATA / "manifest.json"),
        "catalog_sha256": sha256(ROOT / "benchmark/catalog.json"),
        "files": {f"{s}.jsonl": sha256(output / f"{s}.jsonl") for s in ("train", "dev", "test")},
        "counts": {"train": 24, "dev": 8, "test": 16},
        "original_scenarios_with_identifier_hints": sum(bool(identifier_hints(r)) for r in original),
        "opaque_scenarios_with_identifier_hints": 0,
        "intervention": "Only record and memory IDs become opaque; all constraints, user behaviors and terminal labels stay fixed",
        "limitations": ["Existing adapters were trained on category-bearing IDs", "Same evaluation tasks were already used",
                        "Opaque IDs alter tokenization and derived proposal IDs", "No causal isolation of semantic hints alone"],
        "train_file_use": "Reserved for future independently planned corrected training; not trained in this probe"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=PROBE)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        actual = load_frozen(args.output_dir)
        expected = [blind(row) for row in load_frozen()]
        if sorted(actual, key=lambda r: r["id"]) != sorted(expected, key=lambda r: r["id"]):
            raise ValueError("probe differs from the reviewed identifier-only transform")
        print(json.dumps({"validated": len(actual), "identifier_hints": sum(bool(identifier_hints(r)) for r in actual)}))
    else:
        freeze(args.output_dir)
