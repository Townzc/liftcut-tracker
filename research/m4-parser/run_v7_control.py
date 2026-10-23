"""Hash-bound cached controls and frozen inference assembly; no training selection."""
import json
import shutil
from run_v2 import digest, read, write_json
from run_v3 import assemble
from run_v4 import load


def prepare(data, manifests, out, baseline, protocol):
    rows = assemble(data, {v: manifests[v] for v in ("v2", "v3")}, out)
    if len(rows) != protocol["evaluationItems"]:
        raise ValueError("evaluation count drift")
    for row in rows:
        if row["messages"][0]["content"] != manifests["v4"]["trainingSystem"]:
            raise ValueError("SFT prompt drift")
        row["messages"][0]["content"] = manifests["v4"]["enumEvaluationSystem"]
    (out / "all-eval.jsonl").write_bytes(b"".join((json.dumps(r, ensure_ascii=False) + "\n").encode() for r in rows))
    if digest(out / "all-eval.jsonl") != protocol["input"]["sha256"]:
        raise ValueError("input drift")
    for name, expected in protocol["baselineFiles"].items():
        if digest(baseline / name) != expected:
            raise ValueError("cached control hash mismatch: " + name)
    origin = load(baseline / "run.json")
    if origin["commit"] != protocol["baselineCommit"] or not all(any(
            s["name"] == step and s["exit"] == 0 for s in origin["steps"]) for step in ("train-T", "T")):
        raise ValueError("incomplete/wrong cached v6 control")
    for arm in ("H", "T"):
        pred = read(baseline / f"{arm}.jsonl"); audit = load(baseline / f"{arm}.jsonl.audit.json")
        if ([r["id"] for r in pred] != [r["id"] for r in rows] or
                audit["inputSha256"] != protocol["input"]["sha256"] or
                audit["tokenIdsSha256"] != protocol["input"]["tokenIdsSha256"]):
            raise ValueError("cached control input tokens/IDs differ")
    metrics = load(baseline / "T/model/train_metrics.json")
    if any(metrics.get(k) != v for k, v in protocol["trainingMetrics"].items()):
        raise ValueError("cached training parameters differ")
    for arm in ("H", "T"):
        for suffix in (".jsonl", ".jsonl.audit.json"):
            shutil.copyfile(baseline / (arm + suffix), out / (arm + suffix))
    (out / "T/model").mkdir(parents=True)
    shutil.copyfile(baseline / "T/model/train_metrics.json", out / "T/model/train_metrics.json")
    write_json(out / "historical-origin.json", origin)
    write_json(out / "cached-control-verification.json", {"verified": True, "commit": origin["commit"],
        "files": protocol["baselineFiles"], "newPredictions": 0, "note": "Historical control; no speed comparison."})
    return rows
