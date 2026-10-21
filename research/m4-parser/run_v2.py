"""One frozen M4 candidate; Linux, existing verified cache, no downloads/retries.

Work has an absolute deadline and a process-group timeout. Platform power-off
and off-instance backup are separate operator responsibilities, never implied by
this program exiting. Only the maintainer opens the GPU instance.
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
from train.acceptance_v2 import assess, GATES

ROOT = Path(__file__).resolve().parents[2]
M4 = ROOT / "research/m4-parser"
SPLITS = ("dev-eval", "challenge", "old-test", "handwritten")


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""): h.update(block)
    return h.hexdigest()


def read(path):
    rows = [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]
    if not rows or len({r["id"] for r in rows}) != len(rows): raise ValueError("empty/duplicate IDs")
    return rows


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


class Budget:
    def __init__(self, out, stop_at, max_seconds):
        self.out, self.stop_at = Path(out), stop_at
        self.started, self.budget = time.monotonic(), max_seconds
        self.report = {"state": "running", "steps": [], "startedAt": time.time(), "stopAt": stop_at}

    def step(self, name, args, allowed=(0,)):
        left = min(self.stop_at - time.time(), self.budget - (time.monotonic() - self.started))
        if left <= 0: raise TimeoutError("experiment deadline reached")
        print(name, "remaining seconds", round(left), flush=True)
        start = time.monotonic()
        with (self.out / "logs" / f"{name}.log").open("x") as log:
            result = subprocess.run(["timeout", "--signal=TERM", "--kill-after=10s", str(left), *map(str, args)],
                                    cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        self.report["steps"].append({"name": name, "seconds": round(time.monotonic() - start, 2), "exit": result.returncode})
        write_json(self.out / "run.json", self.report)
        if result.returncode not in allowed:
            raise RuntimeError(f"{name} exited {result.returncode}; see {self.out / 'logs' / (name + '.log')}")


def assemble(data, manifest, out):
    for name, expected in manifest["files"].items():
        if digest(data / name) != expected["sha256"] or len(read(data / name)) != expected["lines"]:
            raise ValueError("data manifest mismatch: " + name)
    rows = [row for split in SPLITS for row in read(data / f"{split}.jsonl")]
    if len({r["id"] for r in rows}) != len(rows): raise ValueError("overlapping evaluation IDs")
    if any(any(m["role"] not in ("user", "system") for m in r["messages"]) for r in rows):
        raise ValueError("answer in evaluation")
    with (out / "all-eval.jsonl").open("x", encoding="utf-8") as f:
        f.write("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows))
    return rows


def partition(out, data, name):
    predictions = read(out / f"{name}.jsonl")
    by_id = {r["id"]: r for r in predictions}
    expected = [r for s in SPLITS for r in read(data / f"{s}.gold.jsonl")]
    if set(by_id) != {r["id"] for r in expected}: raise ValueError("prediction/gold IDs differ")
    for split in SPLITS:
        with (out / f"{name}-{split}.jsonl").open("x", encoding="utf-8") as f:
            f.write("".join(json.dumps(by_id[r["id"]], ensure_ascii=False) + "\n" for r in read(data / f"{split}.gold.jsonl")))


def reuse_baseline(previous, manifest_sha, out, protocol, stop_at):
    """Explicit operational recovery; reuse only the completed frozen baseline."""
    previous = Path(previous).resolve()
    if digest(previous / "sha256.json") != manifest_sha:
        raise ValueError("baseline manifest mismatch")
    hashes = json.loads((previous / "sha256.json").read_text())
    names = ("run.json", "all-eval.jsonl", "data-manifest.json", "logs/train.log",
             "old-new-prompt.jsonl", "old-new-prompt.jsonl.audit.json")
    if any(digest(previous / name) != hashes.get(name) for name in names):
        raise ValueError("baseline file mismatch")
    old = json.loads((previous / "run.json").read_text())
    source = "8520b9db248e5c61f4acaf2abc94b3f00dddad64"
    if old["state"] != "stopped" or old["commit"] != source or stop_at > old["stopAt"]:
        raise ValueError("baseline source/state/deadline mismatch")
    steps = {step["name"]: step for step in old["steps"]}
    if steps["old-new-prompt"]["exit"] != 0 or steps["train"]["exit"] != 1:
        raise ValueError("baseline unfinished or not a failed training run")
    if "OutOfMemoryError" not in (previous / "logs/train.log").read_text() or any(p.is_file() for p in (previous / "model").rglob("*")):
        raise ValueError("recovery requires an OOM with no exported candidate")
    for key in ("oldMergedSha256", "dataManifestCanonicalSha256", "gates", "quantization", "maxSeconds"):
        if old["protocol"][key] != protocol[key]: raise ValueError("baseline protocol drift: " + key)
    if old["protocol"]["trainingArgs"] + ["--gradient-checkpointing"] != protocol["trainingArgs"]:
        raise ValueError("only activation checkpointing may change")
    original_predict = subprocess.check_output(["git", "show", source + ":research/m4-parser/train/predict.py"], cwd=ROOT)
    if hashlib.sha256(original_predict).hexdigest() != digest(M4 / "train/predict.py"):
        raise ValueError("baseline inference source changed")
    for name in ("all-eval.jsonl", "data-manifest.json"):
        if digest(previous / name) != digest(out / name): raise ValueError("baseline inputs changed")
    rows = read(out / "all-eval.jsonl")
    predictions = read(previous / "old-new-prompt.jsonl")
    audit = json.loads((previous / "old-new-prompt.jsonl.audit.json").read_text())
    if [r["id"] for r in rows] != [r["id"] for r in predictions] or audit["items"] != len(rows) or audit["inputSha256"] != digest(out / "all-eval.jsonl"):
        raise ValueError("baseline incomplete or reordered")
    for name in names[-2:]:
        with (out / name).open("xb") as target: target.write((previous / name).read_bytes())
    provenance = {"sourceCommit": source, "manifestSha256": manifest_sha, "items": len(rows),
                  "originalStopAt": old["stopAt"], "trainingRestartedFromBase": True}
    write_json(out / "baseline-reuse.json", provenance)
    return provenance


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--commit", required=True)
    ap.add_argument("--stop-at", required=True, type=float, help="absolute UTC epoch deadline, before power-off/backup reserve")
    ap.add_argument("--baseline-run", type=Path)
    ap.add_argument("--baseline-sha256")
    args = ap.parse_args()
    if bool(args.baseline_run) != bool(args.baseline_sha256): raise ValueError("baseline path and manifest SHA are required together")
    protocol = json.loads((M4 / "train/protocol-v2.json").read_text())
    if protocol["gates"] != GATES: raise ValueError("protocol/gate mismatch")
    if os.name != "posix" or not shutil.which("timeout"): raise ValueError("Linux GNU timeout required")
    if not 0 < args.stop_at - time.time() <= protocol["maxSeconds"]: raise ValueError("deadline must be within the frozen time budget")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if commit != args.commit or subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT):
        raise ValueError("reviewed clean commit required")
    out, cache = args.out.resolve(), args.cache.resolve()
    if out.is_relative_to(ROOT) or out.is_relative_to(cache) or cache.is_relative_to(out): raise ValueError("use a new output directory outside checkout/cache")
    out.mkdir(parents=True, exist_ok=False); (out / "logs").mkdir()
    budget = Budget(out, args.stop_at, protocol["maxSeconds"])
    budget.report.update(commit=commit, tree=subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=ROOT, text=True).strip(), protocol=protocol)
    write_json(out / "run.json", budget.report)
    py = cache / "venv/bin/python"
    def python(name, script, *extra, allowed=(0,)):
        budget.step(name, [py, M4 / script, *extra], allowed)
    def node(name, script, *extra):
        budget.step(name, ["node", "--import", "tsx", M4 / script, *extra])
    data = M4 / "data/generated/v2"
    try:
        if shutil.disk_usage(out).free < 20 * 1024**3: raise ValueError("20 GiB free disk required")
        for line in (M4 / "train/base-model.sha256").read_text().splitlines():
            sha, name = line.split()
            if digest(cache / "base" / name) != sha: raise ValueError("base hash mismatch: " + name)
        if digest(cache / "model/merged/model.safetensors") != protocol["oldMergedSha256"]: raise ValueError("baseline hash mismatch")
        # Check actual CUDA and versions without installing or changing the cache.
        budget.step("runtime", [py, "-c", "import torch,transformers,peft,llama_cpp,json; "
            "assert torch.cuda.is_available(); assert torch.cuda.get_device_properties(0).total_memory>=22*1024**3; "
            "assert torch.__version__.split('+')[0]=='2.8.0'; assert transformers.__version__=='5.20.1'; "
            "assert peft.__version__=='0.21.2'; assert llama_cpp.__version__=='0.3.36'; "
            "print(json.dumps({'torch':torch.__version__,'cuda':torch.version.cuda,'gpu':torch.cuda.get_device_name(0),"
            "'transformers':transformers.__version__,'peft':peft.__version__,'llama':llama_cpp.__version__}))"])
        node("manifest-check", "scripts/build-v2.ts", "--check")
        node("data", "scripts/build-v2.ts")
        manifest = json.loads((M4 / "data/v2-manifest.json").read_text())
        if hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest() != protocol["dataManifestCanonicalSha256"]:
            raise ValueError("protocol/data manifest mismatch")
        assemble(data, manifest, out)
        write_json(out / "data-manifest.json", manifest)
        archive = cache / "src/llama_cpp_python-0.3.36.tar.gz"
        if digest(archive) != (M4 / "train/llama-cpp-python.sha256").read_text().strip(): raise ValueError("llama source hash mismatch")
        with tarfile.open(archive) as tar: tar.extractall(out / "src", filter="data")
        converter = out / "src/llama_cpp_python-0.3.36/vendor/llama.cpp"
        def predict(name, model_flag, model, tokenizer):
            python(name, "train/predict.py", model_flag, model, "--tokenizer", tokenizer,
                   "--input", out / "all-eval.jsonl", "--out", out / f"{name}.jsonl", "--threads", "4")
        if args.baseline_run:
            budget.report["reusedBaseline"] = reuse_baseline(args.baseline_run, args.baseline_sha256, out, protocol, args.stop_at)
            write_json(out / "run.json", budget.report)
        else:
            predict("old-new-prompt", "--model", cache / "model/merged", cache / "model/merged")
        python("train", "train/sft.py", "--base", cache / "base", "--train", data / "train.jsonl", "--dev", data / "dev.jsonl",
               "--out", out / "model", *protocol["trainingArgs"])
        predict("merged", "--model", out / "model/merged", out / "model/merged")
        python("export", "train/export_gguf.py", "--merged", out / "model/merged", "--llama-src", converter,
               "--out", out / "gguf", "--threads", "4", "--quantization", protocol["quantization"])
        predict("f16", "--gguf", out / "gguf/parser-f16.gguf", out / "model/merged")
        predict("quant", "--gguf", out / f"gguf/parser-{protocol['quantization']}.gguf", out / "model/merged")
        for reference in ("merged", "f16"):
            python("agreement-" + reference, "train/consistency.py", "--reference", out / f"{reference}.jsonl",
                   "--candidate", out / "quant.jsonl", "--out", out / f"agreement-{reference}.json", allowed=(0, 3))
        for name in ("old-new-prompt", "merged", "f16", "quant"):
            partition(out, data, name)
            for split in SPLITS:
                common = ["--gold", data / f"{split}.gold.jsonl", "--pred", out / f"{name}-{split}.jsonl"]
                node(f"score-{name}-{split}", "scripts/evaluate.ts", *common, "--out", out / f"metrics-{name}-{split}.json")
                node(f"ground-{name}-{split}", "scripts/evaluate-grounding.ts", *common, "--out", out / f"ground-{name}-{split}.json")
        for split in SPLITS:
            node("rules-" + split, "scripts/evaluate.ts", "--rules", "--gold", data / f"{split}.gold.jsonl", "--out", out / f"rules-{split}.json")
        acceptance = assess(out, data)
        write_json(out / "acceptance.json", acceptance)
        budget.report["state"] = "candidate-passed-not-release" if acceptance["candidatePassed"] else "candidate-below-threshold"
    except BaseException as error:
        budget.report.update(state="stopped", error=str(error))
        raise
    finally:
        budget.report["finishedAt"] = time.time()
        write_json(out / "run.json", budget.report)
        # Partial failures remain collectable. No automatic retry or deletion.
        paths = sorted(p for p in out.rglob("*") if p.is_file() and "src" not in p.relative_to(out).parts and p.name != "sha256.json")
        write_json(out / "sha256.json", {p.relative_to(out).as_posix(): digest(p) for p in paths})
    return 0 if acceptance["candidatePassed"] else 3


if __name__ == "__main__": raise SystemExit(main())
