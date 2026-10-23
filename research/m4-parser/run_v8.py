"""Fixed train x inference prompt comparison with a semantic gate before quantization.

One original-base training, three HF streams, two conditional GGUF streams, D only.
No downloads, retry, private acceptance input, or product/model activation.
"""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time
from run_v2 import Budget, digest, read, write_json
from run_v3 import partition, manifest_digest, SPLITS
from run_v8_control import prepare
from v8_acceptance import assess_hf, assess_quant
from run_v4 import load, FOCUS_GATES
from train.acceptance_v2 import GATES

ROOT = Path(__file__).resolve().parents[2]
M4 = ROOT / "research/m4-parser"
ARMS = ("A", "B", "C", "D")
HF = ("B", "C", "D")
QUANT = ("D-F16", "D-Q8")


def validate_protocol(protocol):
    if protocol["gates"] != GATES or protocol["focusGates"] != FOCUS_GATES or protocol["candidate"] != "D":
        raise ValueError("gate/selection drift")
    if (protocol["quantization"] != "q8_0" or protocol["trainingRuns"] != 1 or
            protocol["evaluationItems"] != 1040 or protocol["maximumModelPredictions"] != 5200 or
            protocol["hfModelPredictions"] != 3120 or protocol["cachedPredictions"] != 1040 or
            protocol["newHFOrder"] != list(HF) or protocol["conditionalQuantOrder"] != list(QUANT) or
            protocol["requiredFreeDiskGiB"] != 6 or protocol["requiredStagedWeightBackup"] is not True or
            sum(protocol["storagePlanningBytes"].values()) > 6 * 1024**3):
        raise ValueError("budget/order drift")


def main():
    ap = argparse.ArgumentParser()
    for name in ("cache", "out", "baseline", "commit"):
        ap.add_argument("--" + name, required=True)
    ap.add_argument("--stop-at", required=True, type=float)
    args = ap.parse_args()
    protocol = load(M4 / "train/protocol-v8.json")
    validate_protocol(protocol)
    if os.name != "posix" or not shutil.which("timeout"):
        raise ValueError("Linux GNU timeout required")
    if not 0 < args.stop_at - time.time() <= protocol["maxSeconds"]:
        raise ValueError("invalid deadline")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if commit != args.commit or subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT):
        raise ValueError("reviewed clean commit required")
    out, cache, baseline = [Path(p).resolve() for p in (args.out, args.cache, args.baseline)]
    if any(out.is_relative_to(p) or p.is_relative_to(out) for p in (ROOT, cache, baseline)):
        raise ValueError("output must be separate")
    out.mkdir(parents=True, exist_ok=False)
    (out / "logs").mkdir()
    budget = Budget(out, args.stop_at, protocol["maxSeconds"])
    budget.report.update(commit=commit, protocol=protocol, protocolSha256=digest(M4 / "train/protocol-v8.json"))
    write_json(out / "run.json", budget.report)
    py = cache / "venv/bin/python"
    def python(name, script, *extra, allowed=(0,)):
        budget.step(name, [py, M4 / script, *extra], allowed)
    def node(name, script, *extra):
        budget.step(name, ["node", "--import", "tsx", M4 / script, *extra])
    try:
        if shutil.disk_usage(out).free < protocol["requiredFreeDiskGiB"] * 1024**3:
            raise ValueError("6 GiB free required; completed weights must be staged off-instance before packing")
        budget.step("workspace-bindings", ["node", M4 / "scripts/check-workspace.mjs", "--root", ROOT])
        for name, expected in protocol["sourceLfSha256"].items():
            if hashlib.sha256((ROOT / name).read_bytes().replace(b"\r\n", b"\n")).hexdigest() != expected:
                raise ValueError("source drift: " + name)
        for line in (M4 / "train/base-model.sha256").read_text().splitlines():
            sha, name = line.split()
            if digest(cache / "base" / name) != sha:
                raise ValueError("base hash mismatch")
        archive = cache / "src/llama_cpp_python-0.3.36.tar.gz"
        if digest(archive) != (M4 / "train/llama-cpp-python.sha256").read_text().strip():
            raise ValueError("converter hash mismatch")
        manifests = {}
        for v in ("v2", "v3", "v4", "v6", "v7", "v8"):
            node("check-" + v, f"scripts/build-{v}.ts", "--check")
            node("data-" + v, f"scripts/build-{v}.ts")
            path = M4 / f"data/{v}-manifest.json"
            if manifest_digest(path) != protocol["dataManifestCanonicalSha256"][v]:
                raise ValueError("protocol/data mismatch")
            manifests[v] = load(path)
        for name, expected in manifests["v8"]["files"].items():
            path = M4 / "data/generated/v8" / name
            if digest(path) != expected["sha256"] or len(read(path)) != expected["lines"]:
                raise ValueError("v8 data hash mismatch")
        prepare(M4 / "data/generated", manifests, out, baseline, protocol)
        write_json(out / "data-manifests.json", manifests)
        python("training-input-audit", "train/audit_v8_inputs.py", "--data", M4 / "data/generated/v8", "--eval-dir", out,
               "--tokenizer", cache / "base", "--expected", M4 / "train/protocol-v8.json", "--out", out / "input-audit.json")
        budget.step("runtime", [py, "-c", "import torch,transformers,peft,llama_cpp; "
            "assert torch.cuda.is_available() and torch.cuda.is_bf16_supported() and torch.cuda.get_device_properties(0).total_memory>=22*1024**3; "
            "assert torch.__version__.split('+')[0]=='2.8.0' and transformers.__version__=='5.20.1'; "
            "assert peft.__version__=='0.21.2' and llama_cpp.__version__=='0.3.36'; print(torch.cuda.get_device_name(0))"])
        converter = out / "src/llama_cpp_python-0.3.36/vendor/llama.cpp"
        def train(arm, script):
            python("train-" + arm, script, "--base", cache / "base", "--train", M4 / f"data/generated/v8/{arm}-train.jsonl",
                   "--dev", M4 / "data/generated/v8/D-dev.jsonl", "--out", out / arm / "model", *protocol["trainingArgs"])
        def export(arm):
            python("export-" + arm, "train/export_gguf.py", "--merged", out / arm / "model/merged",
                   "--llama-src", converter, "--out", out / arm / "gguf", "--threads", "4", "--quantization", "q8_0")
        def predict(name, flag, model, variant):
            python(name, "train/predict.py", flag, model, "--tokenizer", cache / "base",
                   "--input", out / ("all-eval-" + variant + ".jsonl"), "--out", out / f"{name}.jsonl", "--threads", "4", "--max-new-tokens", "256")
        def score(arm):
            partition(out, arm)
            for split in SPLITS:
                for kind, script in (("metrics", "evaluate"), ("ground", "evaluate-grounding"), ("compare", "compare-source")):
                    node(f"{kind}-{arm}-{split}", f"scripts/{script}.ts", "--gold", out / f"{split}.gold.jsonl",
                         "--pred", out / f"{arm}-{split}.jsonl", "--out", out / f"{kind}-{arm}-{split}.json")
        train("D", "train/sft.py")
        predict("B", "--model", baseline / "S/model/merged", "contract")
        predict("C", "--model", out / "D/model/merged", "enum")
        predict("D", "--model", out / "D/model/merged", "contract")
        for arm in ARMS:
            score(arm)
        node("hf-summary", "scripts/summarize-v8.ts", "--out-dir", out, "--phase", "hf")
        hf = assess_hf(out, protocol)
        write_json(out / "hf-acceptance.json", hf)
        if not hf["hfGatePassed"]:
            result = hf
            budget.report["state"] = "semantic-rejected"
            budget.report["quantization"] = "not-run-semantic-rejection"
        else:
            # Extraction/export and slow GGUF evaluation happen only after the fixed HF semantic gates pass.
            with tarfile.open(archive) as tar:
                tar.extractall(out / "src", filter="data")
            export("D")
            predict("D-F16", "--gguf", out / "D/gguf/parser-f16.gguf", "contract")
            predict("D-Q8", "--gguf", out / "D/gguf/parser-q8_0.gguf", "contract")
            for arm in ("D", "D-F16"):
                python("agreement-" + arm, "train/consistency.py", "--reference", out / f"{arm}.jsonl",
                       "--candidate", out / "D-Q8.jsonl", "--out", out / f"agreement-{arm}.json", allowed=(0, 3))
            for arm in QUANT:
                score(arm)
            node("quant-summary", "scripts/summarize-v8.ts", "--out-dir", out, "--phase", "quant")
            result = assess_quant(out, protocol)
            budget.report["state"] = "development-passed-not-release" if result["developmentGatePassed"] else "quantization-rejected"
            budget.report["quantization"] = "measured"
        write_json(out / "acceptance.json", result)
    except BaseException as error:
        budget.report.update(state="stopped", error=str(error))
        raise
    finally:
        budget.report["finishedAt"] = time.time()
        write_json(out / "run.json", budget.report)
        write_json(out / "sha256.json", {p.relative_to(out).as_posix(): digest(p) for p in sorted(out.rglob("*"))
            if p.is_file() and "src" not in p.relative_to(out).parts and p.name != "sha256.json"})
    return 0 if result["developmentGatePassed"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
