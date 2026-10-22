"""Describe an already scored paired run; never changes labels or reruns a model."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path


def analyze(run: Path, scored: Path):
    def rows(name):
        return [json.loads(line) for line in (run / name).read_text(encoding="utf-8-sig").splitlines() if line]

    gold = rows("challenge.gold.jsonl")
    previous = {r["id"]: r for r in rows("previous-q8.jsonl")}
    current = {r["id"]: r for r in rows("quant.jsonl")}
    failed = {arm: set(json.loads((scored / f"compare-{arm}-challenge.json").read_text())["metrics"]["raw"]["failureIds"])
              for arm in ("previous-q8", "quant")}
    families, transitions, paired = defaultdict(Counter), Counter(), Counter()
    for row in gold:
        key = row["id"]
        assert key in previous and key in current
        old_ok, new_ok = key not in failed["previous-q8"], key not in failed["quant"]
        counts = families[row["family"]]
        counts.update(n=1, previous=int(old_ok), current=int(new_ok),
                      regressed=int(old_ok and not new_ok), improved=int(new_ok and not old_ok))
        paired["both_correct" if old_ok and new_ok else "regressed" if old_ok else "improved" if new_ok else "both_wrong"] += 1
        if old_ok and not new_ok:
            try:
                output = json.loads(current[key]["output"])
                intent = output.get("intent", "missing") if isinstance(output, dict) else "invalid_shape"
            except (ValueError, TypeError):
                intent = "invalid_json"
            transitions[f'{row["label"]["intent"]} -> {intent}'] += 1
    assert sum(paired.values()) == len(gold)
    files = [run / name for name in ("challenge.gold.jsonl", "previous-q8.jsonl", "quant.jsonl")]
    files += [scored / f"compare-{arm}-challenge.json" for arm in failed]
    return {"method": "paired existing frozen-scorer failures; no new inference, normalization or training",
            "n": len(gold), "paired": dict(paired), "regression_intents": dict(transitions),
            "families": dict(sorted(families.items())),
            "source_sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--scored-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = analyze(args.run_dir, args.scored_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["paired"]))
