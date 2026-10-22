"""Fixed corrected-label control vs catalog augmentation, with a cached v4 reference.

Two original-base trainings, four new streams, one preselected S candidate.
No downloads, retry, private acceptance input, or product/model activation.
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
from run_v3 import partition, manifest_digest, SPLITS
from run_v5 import prepare
from run_v4 import load, FOCUS_GATES
from train.acceptance_v2 import GATES

ROOT = Path(__file__).resolve().parents[2]
M4 = ROOT / "research/m4-parser"
ARMS = ("H", "T", "S")
NEW = ("T", "S-HF", "S-F16", "S")
CANDIDATE_STREAMS = ("S-HF", "S-F16", "S")



def assess(out, protocol):
    ids = [r["id"] for r in read(out / "all-eval.jsonl")]
    outputs = {a: read(out / f"{a}.jsonl") for a in (*ARMS, "S-HF", "S-F16")}
    audits_ok = len(ids) == protocol["evaluationItems"]
    for arm, rows in outputs.items():
        audit = load(out / f"{arm}.jsonl.audit.json")
        hf = arm == "S-HF"
        audits_ok &= [r["id"] for r in rows] == ids and audit["items"] == len(ids)
        audits_ok &= audit["inputSha256"] == protocol["input"]["sha256"]
        audits_ok &= audit["tokenIdsSha256"] == protocol["input"]["tokenIdsSha256"]
        audits_ok &= audit["greedy"] and audit["repetitionPenalty"] == 1 and audit["maxNewTokens"] == 256
        audits_ok &= audit["engine"] == ("hf" if hf else "gguf") and (hf or
            audit["threads"] == audit["prefillThreads"] == 4 and audit["resetBetweenItems"])
    training_ok = True
    for arm in ("T", "S"):
        metrics = load(out / arm / "model/train_metrics.json")
        training_ok &= all(metrics.get(k) == v for k, v in protocol["trainingMetrics"].items())
        training_ok &= metrics.get("objective", "token-mean-answer-token-ce") == "token-mean-answer-token-ce"
    raw = load(out / "metrics-S-challenge.json")
    coverage, safe = {}, True
    for split in SPLITS:
        gold = read(out / f"{split}.gold.jsonl")
        report = load(out / f"ground-S-{split}.json")
        actionable = sum(r["label"]["intent"] != "clarify" for r in gold)
        if report["guarded"]["total"] != len(gold) or not actionable:
            raise ValueError("grounding denominator mismatch")
        coverage[split] = (report["accepted"] - report["unsafeAccepted"]) / actionable
        safe &= report["unsafeAccepted"] == report["guarded"]["invented"] == GATES["guardedUnsafe"]
    agreements = [load(out / f"agreement-{a}.json") for a in ("S-HF", "S-F16")]
    focus = load(out / "catalog-summary.json")["arms"]["S"]
    checks = {
        "sameInputs": bool(audits_ok), "fixedTraining": bool(training_ok),
        "reviewedTrainingTokens": load(out / "training-input-audit.json") == protocol["trainingInputAudit"],
        "rawAgreement": all(a["items"] == len(ids) and a["missing"] == 0 and
                            a["sameParsed"] / len(ids) >= GATES["rawAgreement"] for a in agreements),
        "noTruncation": all(r.get("finishReason") == "stop" for a in CANDIDATE_STREAMS for r in outputs[a]),
        "challengeExact": raw["exactRate"] >= GATES["challengeExact"],
        "challengeSchema": raw["schemaValidRate"] >= GATES["challengeSchema"],
        "challengeNoInvented": raw["invented"] == GATES["rawChallengeInvented"],
        "guardedSafety": safe, "challengeCoverage": coverage["challenge"] >= GATES["challengeCoverage"],
        "focusNegativeReasons": set(focus["focus"]) == {"missing_unit", "rpe_scope", "unknown_exercise"} and all(
            f["negativeTotal"] == 15 and f["correctReason"] / 15 >= FOCUS_GATES["negativeReasonExact"] for f in focus["focus"].values()),
        "focusPositiveUseful": all(f["positiveTotal"] == 15 and
            f["positiveExact"] / 15 >= FOCUS_GATES["positiveExact"] for f in focus["focus"].values()),
        "challengePositiveUseful": focus["challengePositive"]["total"] == 120 and
            focus["challengePositive"]["exact"] / 120 >= FOCUS_GATES["positiveExact"],
        "clarificationVocabulary": focus["invalidClarificationReasons"] == FOCUS_GATES["invalidClarificationReasons"],
    }
    return {"candidate": "S", "developmentGatePassed": all(checks.values()), "checks": checks,
        "coverage": coverage, "releaseReady": False,
        "pending": ["passing-candidate continuous acceptance", "useful coverage beyond source-only parsing",
                    "native integration", "physical-device acceptance"],
        "note": "Candidate S plus its two references must never truncate. T and historical H remain diagnostics, never substitutes. Observed inputs."}


def main():
    ap = argparse.ArgumentParser()
    for name in ("cache", "out", "baseline", "commit"):
        ap.add_argument("--" + name, required=True)
    ap.add_argument("--stop-at", required=True, type=float)
    args = ap.parse_args()
    protocol = load(M4 / "train/protocol-v6.json")
    if protocol["gates"] != GATES or protocol["focusGates"] != FOCUS_GATES or protocol["candidate"] != "S":
        raise ValueError("gate/selection drift")
    if (protocol["quantization"] != "q8_0" or protocol["trainingRuns"] != 2 or
            protocol["maximumModelPredictions"] != len(NEW) * protocol["evaluationItems"] or
            protocol["newStreamOrder"] != list(NEW)):
        raise ValueError("budget/order drift")
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
    budget.report.update(commit=commit, protocol=protocol, protocolSha256=digest(M4 / "train/protocol-v6.json"))
    write_json(out / "run.json", budget.report)
    py = cache / "venv/bin/python"
    def python(name, script, *extra, allowed=(0,)):
        budget.step(name, [py, M4 / script, *extra], allowed)
    def node(name, script, *extra):
        budget.step(name, ["node", "--import", "tsx", M4 / script, *extra])
    try:
        if shutil.disk_usage(out).free < protocol["requiredFreeDiskGiB"] * 1024**3:
            raise ValueError("16 GiB free required for two weight sets, a full archive and reserves")
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
        for v in ("v2", "v3", "v4", "v6"):
            node("check-" + v, f"scripts/build-{v}.ts", "--check")
            node("data-" + v, f"scripts/build-{v}.ts")
            path = M4 / f"data/{v}-manifest.json"
            if manifest_digest(path) != protocol["dataManifestCanonicalSha256"][v]:
                raise ValueError("protocol/data mismatch")
            manifests[v] = load(path)
        for name, expected in manifests["v6"]["files"].items():
            path = M4 / "data/generated/v6" / name
            if digest(path) != expected["sha256"] or len(read(path)) != expected["lines"]:
                raise ValueError("v6 data hash mismatch")
        prepare(M4 / "data/generated", manifests, out, baseline, protocol)
        write_json(out / "data-manifests.json", manifests)
        python("training-input-audit", "train/audit_v6_inputs.py", "--data", M4 / "data/generated/v6",
               "--tokenizer", cache / "base", "--expected", M4 / "train/protocol-v6.json", "--out", out / "training-input-audit.json")
        budget.step("runtime", [py, "-c", "import torch,transformers,peft,llama_cpp; "
            "assert torch.cuda.is_available() and torch.cuda.is_bf16_supported() and torch.cuda.get_device_properties(0).total_memory>=22*1024**3; "
            "assert torch.__version__.split('+')[0]=='2.8.0' and transformers.__version__=='5.20.1'; "
            "assert peft.__version__=='0.21.2' and llama_cpp.__version__=='0.3.36'; print(torch.cuda.get_device_name(0))"])
        with tarfile.open(archive) as tar:
            tar.extractall(out / "src", filter="data")
        converter = out / "src/llama_cpp_python-0.3.36/vendor/llama.cpp"
        def train(arm, script):
            python("train-" + arm, script, "--base", cache / "base", "--train", M4 / f"data/generated/v6/{arm}-train.jsonl",
                   "--dev", M4 / "data/generated/v6/dev.jsonl", "--out", out / arm / "model", *protocol["trainingArgs"])
        def export(arm):
            python("export-" + arm, "train/export_gguf.py", "--merged", out / arm / "model/merged",
                   "--llama-src", converter, "--out", out / arm / "gguf", "--threads", "4", "--quantization", "q8_0")
        def predict(name, flag, model):
            python(name, "train/predict.py", flag, model, "--tokenizer", cache / "base",
                   "--input", out / "all-eval.jsonl", "--out", out / f"{name}.jsonl", "--threads", "4", "--max-new-tokens", "256")
        train("T", "train/sft.py")
        export("T")
        predict("T", "--gguf", out / "T/gguf/parser-q8_0.gguf")
        train("S", "train/sft.py")
        predict("S-HF", "--model", out / "S/model/merged")
        export("S")
        predict("S-F16", "--gguf", out / "S/gguf/parser-f16.gguf")
        predict("S", "--gguf", out / "S/gguf/parser-q8_0.gguf")
        for arm in ("S-HF", "S-F16"):
            python("agreement-" + arm, "train/consistency.py", "--reference", out / f"{arm}.jsonl",
                   "--candidate", out / "S.jsonl", "--out", out / f"agreement-{arm}.json", allowed=(0, 3))
        for arm in ARMS:
            partition(out, arm)
            for split in SPLITS:
                for kind, script in (("metrics", "evaluate"), ("ground", "evaluate-grounding"), ("compare", "compare-source")):
                    node(f"{kind}-{arm}-{split}", f"scripts/{script}.ts", "--gold", out / f"{split}.gold.jsonl",
                         "--pred", out / f"{arm}-{split}.jsonl", "--out", out / f"{kind}-{arm}-{split}.json")
        node("catalog-summary", "scripts/summarize-v6.ts", "--out-dir", out)
        result = assess(out, protocol)
        write_json(out / "acceptance.json", result)
        budget.report["state"] = "development-passed-not-release" if result["developmentGatePassed"] else "below-threshold"
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
