"""One bounded v3 development candidate. No downloads, retries or activation.

The frozen v2 runner/results are untouched. Known development/challenge/handwritten
inputs measure diagnostics, not unseen generalization. Private scenario text is
not accepted as a training or evaluation input by this runner.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time
from run_v2 import Budget, digest, read, write_json
from train.acceptance_v2 import GATES

ROOT = Path(__file__).resolve().parents[2]
M4 = ROOT / "research/m4-parser"
SPLITS = {"dev-eval": ("v3", "dev-eval", "dev"), "challenge": ("v2", "challenge", "challenge"),
          "handwritten": ("v2", "handwritten", "handwritten")}
ARMS = ("previous-q8", "merged", "f16", "quant")


def manifest_digest(path):
    return hashlib.sha256(json.dumps(json.loads(Path(path).read_text()), sort_keys=True).encode()).hexdigest()


def assemble(data, manifests, out):
    for version, manifest in manifests.items():
        for name, expected in manifest["files"].items():
            path = data / version / name
            if digest(path) != expected["sha256"] or len(read(path)) != expected["lines"]:
                raise ValueError("data manifest mismatch: " + str(path))
    rows, seen = [], set()
    for split, (version, name, gold) in SPLITS.items():
        inputs = read(data / version / f"{name}.jsonl")
        labels = read(data / version / f"{gold}.gold.jsonl")
        if {r["id"] for r in inputs} != {r["id"] for r in labels}: raise ValueError("input/gold IDs differ")
        for row in inputs:
            if row["id"] in seen: raise ValueError("overlapping evaluation IDs")
            if set(row) != {"id", "messages"} or [m["role"] for m in row["messages"]] != ["system", "user"]:
                raise ValueError("answer/history in evaluation")
            user = json.loads(row["messages"][1]["content"])
            if set(user) != {"exercises", "sentence"}: raise ValueError("evaluation input outside allowlist")
            seen.add(row["id"])
        rows.extend(inputs)
        shutil.copyfile(data / version / f"{gold}.gold.jsonl", out / f"{split}.gold.jsonl")
    with (out / "all-eval.jsonl").open("x", encoding="utf-8") as f:
        f.write("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows))
    return rows


def partition(out, name):
    predictions = read(out / f"{name}.jsonl"); by_id = {r["id"]: r for r in predictions}
    golds = {s: read(out / f"{s}.gold.jsonl") for s in SPLITS}
    if set(by_id) != {r["id"] for rows in golds.values() for r in rows}: raise ValueError("prediction IDs differ")
    for split, gold in golds.items():
        with (out / f"{name}-{split}.jsonl").open("x", encoding="utf-8") as f:
            f.write("".join(json.dumps(by_id[r["id"]], ensure_ascii=False) + "\n" for r in gold))


def assess(out):
    load = lambda name: json.loads((out / name).read_text(encoding="utf-8"))
    outputs = {arm: read(out / f"{arm}.jsonl") for arm in ARMS}
    audits = [load(arm + ".jsonl.audit.json") for arm in ARMS]
    total = len(outputs["quant"])
    same_ids = all([r["id"] for r in rows] == [r["id"] for r in outputs["quant"]] for rows in outputs.values())
    raw = load("metrics-quant-challenge.json")
    coverage, safe = {}, True
    for split in SPLITS:
        gold = read(out / f"{split}.gold.jsonl"); report = load(f"ground-quant-{split}.json")
        actionable = sum(r["label"]["intent"] != "clarify" for r in gold)
        if report["guarded"]["total"] != len(gold) or not actionable: raise ValueError("grounding denominator mismatch")
        coverage[split] = (report["accepted"] - report["unsafeAccepted"]) / actionable
        safe &= report["unsafeAccepted"] == report["guarded"]["invented"] == 0
    agreements = [load(f"agreement-{arm}.json") for arm in ("merged", "f16")]
    checks = {"sameInputTokens": same_ids and all(a["items"] == total and a["inputSha256"] == audits[0]["inputSha256"]
        and a["tokenIdsSha256"] == audits[0]["tokenIdsSha256"] for a in audits),
        "rawAgreement": all(a["items"] == total and a["missing"] == 0 and a["sameParsed"] / total >= GATES["rawAgreement"] for a in agreements),
        "noTruncation": all(r.get("finishReason") == "stop" for rows in outputs.values() for r in rows),
        "challengeExact": raw["exactRate"] >= GATES["challengeExact"],
        "challengeSchema": raw["schemaValidRate"] >= GATES["challengeSchema"],
        "challengeNoInvented": raw["invented"] == GATES["rawChallengeInvented"],
        "guardedSafety": safe, "challengeCoverage": coverage["challenge"] >= GATES["challengeCoverage"]}
    return {"developmentGatePassed": all(checks.values()), "checks": checks, "coverage": coverage,
        "releaseReady": False, "pending": ["continuous natural-language Agent acceptance", "useful coverage beyond rules", "native and physical-device acceptance"],
        "note": "Observed diagnostic sets; original thresholds and source-v1 gate retained. Source-v2 is an additional comparison, not a substituted pass."}


def main():
    ap = argparse.ArgumentParser()
    for name in ("cache", "out", "previous-gguf", "commit"):
        ap.add_argument("--" + name, required=True)
    ap.add_argument("--stop-at", required=True, type=float)
    args = ap.parse_args()
    protocol = json.loads((M4 / "train/protocol-v3.json").read_text())
    if protocol["gates"] != GATES or protocol["quantization"] != "q8_0": raise ValueError("gate drift")
    if os.name != "posix" or not shutil.which("timeout"): raise ValueError("Linux GNU timeout required")
    if not 0 < args.stop_at - time.time() <= protocol["maxSeconds"]: raise ValueError("invalid deadline")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if commit != args.commit or subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT):
        raise ValueError("reviewed clean commit required")
    out, cache, previous = map(lambda s: Path(s).resolve(), (args.out, args.cache, args.previous_gguf))
    if out.is_relative_to(ROOT) or out.is_relative_to(cache) or cache.is_relative_to(out) or previous.is_relative_to(out):
        raise ValueError("output must be separate from checkout/cache/baseline")
    out.mkdir(parents=True, exist_ok=False); (out / "logs").mkdir()
    budget = Budget(out, args.stop_at, protocol["maxSeconds"])
    budget.report.update(commit=commit, protocol=protocol, protocolSha256=digest(M4 / "train/protocol-v3.json"))
    write_json(out / "run.json", budget.report)
    py = cache / "venv/bin/python"
    def python(name, script, *extra, allowed=(0,)):
        budget.step(name, [py, M4 / script, *extra], allowed)
    def node(name, script, *extra):
        budget.step(name, ["node", "--import", "tsx", M4 / script, *extra])
    try:
        if shutil.disk_usage(out).free < 20 * 1024**3: raise ValueError("20 GiB free required")
        budget.step("workspace-bindings", ["node", M4 / "scripts/check-workspace.mjs", "--root", ROOT])
        for line in (M4 / "train/base-model.sha256").read_text().splitlines():
            sha, name = line.split()
            if digest(cache / "base" / name) != sha: raise ValueError("base hash mismatch")
        if digest(previous) != protocol["previousQ8Sha256"]: raise ValueError("baseline hash mismatch")
        budget.step("runtime", [py, "-c", "import torch,transformers,peft,llama_cpp; "
            "assert torch.cuda.is_available() and torch.cuda.get_device_properties(0).total_memory>=22*1024**3; "
            "assert torch.__version__.split('+')[0]=='2.8.0' and transformers.__version__=='5.20.1'; "
            "assert peft.__version__=='0.21.2' and llama_cpp.__version__=='0.3.36'; print(torch.cuda.get_device_name(0))"])
        manifests = {}
        for version in ("v2", "v3"):
            node("check-" + version, f"scripts/build-{version}.ts", "--check")
            node("data-" + version, f"scripts/build-{version}.ts")
            path = M4 / f"data/{version}-manifest.json"
            if manifest_digest(path) != protocol["dataManifestCanonicalSha256"][version]: raise ValueError("protocol/data mismatch")
            manifests[version] = json.loads(path.read_text())
        rows = assemble(M4 / "data/generated", manifests, out)
        if len(rows) != protocol["evaluationItems"] or len(rows) * len(ARMS) != protocol["maximumModelPredictions"]:
            raise ValueError("evaluation count drift")
        write_json(out / "data-manifests.json", manifests)
        archive = cache / "src/llama_cpp_python-0.3.36.tar.gz"
        if digest(archive) != (M4 / "train/llama-cpp-python.sha256").read_text().strip(): raise ValueError("converter hash mismatch")
        with tarfile.open(archive) as tar: tar.extractall(out / "src", filter="data")
        converter = out / "src/llama_cpp_python-0.3.36/vendor/llama.cpp"
        def predict(name, flag, model, tokenizer):
            python(name, "train/predict.py", flag, model, "--tokenizer", tokenizer, "--input", out / "all-eval.jsonl",
                "--out", out / f"{name}.jsonl", "--threads", "4")
        predict("previous-q8", "--gguf", previous, cache / "base")
        python("train", "train/sft.py", "--base", cache / "base", "--train", M4 / "data/generated/v3/train.jsonl",
            "--dev", M4 / "data/generated/v3/dev.jsonl", "--out", out / "model", *protocol["trainingArgs"])
        predict("merged", "--model", out / "model/merged", out / "model/merged")
        python("export", "train/export_gguf.py", "--merged", out / "model/merged", "--llama-src", converter,
            "--out", out / "gguf", "--threads", "4", "--quantization", "q8_0")
        predict("f16", "--gguf", out / "gguf/parser-f16.gguf", out / "model/merged")
        predict("quant", "--gguf", out / "gguf/parser-q8_0.gguf", out / "model/merged")
        for arm in ("merged", "f16"):
            python("agreement-" + arm, "train/consistency.py", "--reference", out / f"{arm}.jsonl", "--candidate", out / "quant.jsonl",
                "--out", out / f"agreement-{arm}.json", allowed=(0, 3))
        for arm in ARMS:
            partition(out, arm)
            for split in SPLITS:
                common = ["--gold", out / f"{split}.gold.jsonl", "--pred", out / f"{arm}-{split}.jsonl"]
                for kind, script in (("metrics", "evaluate"), ("ground", "evaluate-grounding"), ("compare", "compare-source")):
                    node(f"{kind}-{arm}-{split}", f"scripts/{script}.ts", *common, "--out", out / f"{kind}-{arm}-{split}.json")
        result = assess(out); write_json(out / "acceptance.json", result)
        budget.report["state"] = "development-passed-not-release" if result["developmentGatePassed"] else "below-threshold"
    except BaseException as error:
        budget.report.update(state="stopped", error=str(error)); raise
    finally:
        budget.report["finishedAt"] = time.time(); write_json(out / "run.json", budget.report)
        write_json(out / "sha256.json", {p.relative_to(out).as_posix(): digest(p) for p in sorted(out.rglob("*"))
            if p.is_file() and "src" not in p.relative_to(out).parts and p.name != "sha256.json"})
    return 0 if result["developmentGatePassed"] else 3


if __name__ == "__main__": raise SystemExit(main())
