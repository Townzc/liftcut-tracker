"""One fixed data × prompt experiment; archived A, five new prediction streams.

No downloads, selection sweep, private acceptance inputs or product activation.
The operator retains responsibility for verified backup and platform shutdown.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time
from run_v2 import Budget, digest, read, write_json
from run_v3 import assemble, partition, manifest_digest, SPLITS
from train.acceptance_v2 import GATES

ROOT = Path(__file__).resolve().parents[2]
M4 = ROOT / "research/m4-parser"
ARMS = ("A", "B", "C", "D")
NEW = ("B", "D-HF", "D-F16", "C", "D")
FOCUS_GATES = {"negativeReasonExact": .90, "positiveExact": .90, "invalidClarificationReasons": 0}


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def jsonl(path, rows):
    with Path(path).open("xb") as f:
        f.write("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows).encode())


def prepare(data, manifests, out, baseline, protocol):
    rows = assemble(data, {v: manifests[v] for v in ("v2", "v3")}, out)
    # Explicit UTF-8/LF serialization also makes the CPU audit portable on Windows.
    short = out / "all-eval.jsonl"
    short.write_bytes("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows).encode())
    if len(rows) != protocol["evaluationItems"]: raise ValueError("evaluation count drift")
    enum = copy.deepcopy(rows)
    for row in enum:
        if row["messages"][0]["content"] != manifests["v4"]["trainingSystem"]: raise ValueError("SFT prompt drift")
        row["messages"][0]["content"] = manifests["v4"]["enumEvaluationSystem"]
    jsonl(out / "enum-eval.jsonl", enum)
    for kind, name in (("short", "all-eval"), ("enum", "enum-eval")):
        if digest(out / f"{name}.jsonl") != protocol["inputs"][kind]["sha256"]: raise ValueError("prompt input drift")
    for name, expected in protocol["baselineFiles"].items():
        if digest(baseline / name) != expected: raise ValueError("archived baseline hash mismatch: " + name)
    origin = load(baseline / "run.json")
    if origin["commit"] != protocol["baselineCommit"]: raise ValueError("baseline source drift")
    if not any(s["name"] == "quant" and s["exit"] == 0 for s in origin["steps"]): raise ValueError("incomplete baseline")
    if [r["id"] for r in read(baseline / "quant.jsonl")] != [r["id"] for r in rows]: raise ValueError("baseline IDs differ")
    audit = load(baseline / "quant.jsonl.audit.json")
    if audit["inputSha256"] != digest(short) or audit["tokenIdsSha256"] != protocol["inputs"]["short"]["tokenIdsSha256"]:
        raise ValueError("baseline input tokens differ")
    shutil.copyfile(baseline / "quant.jsonl", out / "A.jsonl")
    shutil.copyfile(baseline / "quant.jsonl.audit.json", out / "A.jsonl.audit.json")
    shutil.copyfile(baseline / "run.json", out / "baseline-origin.json")
    return rows


def assess(out, protocol):
    outputs = {a: read(out / f"{a}.jsonl") for a in (*ARMS, "D-HF", "D-F16")}
    ids = [r["id"] for r in read(out / "all-eval.jsonl")]
    audits_ok = len(ids) == protocol["evaluationItems"]
    for arm, rows in outputs.items():
        audit = load(out / f"{arm}.jsonl.audit.json")
        expected = protocol["inputs"]["short" if arm in ("A", "C") else "enum"]
        hf = arm == "D-HF"
        audits_ok &= [r["id"] for r in rows] == ids and audit["items"] == len(ids)
        audits_ok &= audit["inputSha256"] == expected["sha256"] and audit["tokenIdsSha256"] == expected["tokenIdsSha256"]
        audits_ok &= audit["greedy"] and audit["repetitionPenalty"] == 1 and audit["maxNewTokens"] == 256
        audits_ok &= audit["engine"] == ("hf" if hf else "gguf") and (hf or
            audit["threads"] == audit["prefillThreads"] == 4 and audit["resetBetweenItems"])
    raw = load(out / "metrics-D-challenge.json")
    coverage, safe = {}, True
    for split in SPLITS:
        gold = read(out / f"{split}.gold.jsonl"); report = load(out / f"ground-D-{split}.json")
        actionable = sum(r["label"]["intent"] != "clarify" for r in gold)
        if report["guarded"]["total"] != len(gold) or not actionable: raise ValueError("grounding denominator mismatch")
        coverage[split] = (report["accepted"] - report["unsafeAccepted"]) / actionable
        safe &= report["unsafeAccepted"] == report["guarded"]["invented"] == GATES["guardedUnsafe"]
    agreements = [load(out / f"agreement-{a}.json") for a in ("D-HF", "D-F16")]
    focus = load(out / "factor-summary.json")["arms"]["D"]
    checks = {"sameFactorInputs": bool(audits_ok), "rawAgreement": all(a["items"] == len(ids) and a["missing"] == 0
        and a["sameParsed"] / len(ids) >= GATES["rawAgreement"] for a in agreements),
        "noTruncation": all(r.get("finishReason") == "stop" for rows in outputs.values() for r in rows),
        "challengeExact": raw["exactRate"] >= GATES["challengeExact"], "challengeSchema": raw["schemaValidRate"] >= GATES["challengeSchema"],
        "challengeNoInvented": raw["invented"] == GATES["rawChallengeInvented"], "guardedSafety": safe,
        "challengeCoverage": coverage["challenge"] >= GATES["challengeCoverage"],
        "focusNegativeReasons": set(focus["focus"]) == {"missing_unit", "rpe_scope", "unknown_exercise"} and all(f["negativeTotal"] == 15 and f["correctReason"] / 15 >= FOCUS_GATES["negativeReasonExact"] for f in focus["focus"].values()),
        "focusPositiveUseful": all(f["positiveTotal"] == 15 and f["positiveExact"] / 15 >= FOCUS_GATES["positiveExact"] for f in focus["focus"].values()),
        "challengePositiveUseful": focus["challengePositive"]["total"] == 120 and focus["challengePositive"]["exact"] / 120 >= FOCUS_GATES["positiveExact"],
        "clarificationVocabulary": focus["invalidClarificationReasons"] == FOCUS_GATES["invalidClarificationReasons"]}
    return {"candidate": "D", "developmentGatePassed": all(checks.values()), "checks": checks, "coverage": coverage,
        "releaseReady": False, "pending": ["passing-candidate continuous acceptance", "useful coverage beyond deterministic source baseline", "native integration", "physical-device acceptance"],
        "note": "Original source-v1 gates retained. Source-v2 and other arms cannot replace a failed D. Observed diagnostic inputs."}


def main():
    ap = argparse.ArgumentParser()
    for name in ("cache", "out", "baseline", "commit"): ap.add_argument("--" + name, required=True)
    ap.add_argument("--stop-at", required=True, type=float); args = ap.parse_args()
    protocol = load(M4 / "train/protocol-v4.json")
    if protocol["gates"] != GATES or protocol["focusGates"] != FOCUS_GATES or protocol["candidate"] != "D": raise ValueError("gate/selection drift")
    if protocol["quantization"] != "q8_0" or protocol["maximumModelPredictions"] != len(NEW) * protocol["evaluationItems"]: raise ValueError("budget drift")
    if os.name != "posix" or not shutil.which("timeout"): raise ValueError("Linux GNU timeout required")
    if not 0 < args.stop_at - time.time() <= protocol["maxSeconds"]: raise ValueError("invalid deadline")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if commit != args.commit or subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT): raise ValueError("reviewed clean commit required")
    out, cache, baseline = [Path(p).resolve() for p in (args.out, args.cache, args.baseline)]
    if any(out.is_relative_to(p) or p.is_relative_to(out) for p in (ROOT, cache, baseline)): raise ValueError("output must be separate")
    out.mkdir(parents=True, exist_ok=False); (out / "logs").mkdir()
    budget = Budget(out, args.stop_at, protocol["maxSeconds"])
    budget.report.update(commit=commit, protocol=protocol, protocolSha256=digest(M4 / "train/protocol-v4.json"))
    write_json(out / "run.json", budget.report)
    py = cache / "venv/bin/python"
    def python(name, script, *extra, allowed=(0,)):
        budget.step(name, [py, M4 / script, *extra], allowed)
    def node(name, script, *extra): budget.step(name, ["node", "--import", "tsx", M4 / script, *extra])
    try:
        if shutil.disk_usage(out).free < 20 * 1024**3: raise ValueError("20 GiB free required")
        budget.step("workspace-bindings", ["node", M4 / "scripts/check-workspace.mjs", "--root", ROOT])
        for name, expected in protocol["sourceLfSha256"].items():
            if hashlib.sha256((ROOT / name).read_bytes().replace(b"\r\n", b"\n")).hexdigest() != expected: raise ValueError("source drift: " + name)
        for line in (M4 / "train/base-model.sha256").read_text().splitlines():
            sha, name = line.split()
            if digest(cache / "base" / name) != sha: raise ValueError("base hash mismatch")
        archive = cache / "src/llama_cpp_python-0.3.36.tar.gz"
        if digest(archive) != (M4 / "train/llama-cpp-python.sha256").read_text().strip(): raise ValueError("converter hash mismatch")
        manifests = {}
        for v in ("v2", "v3", "v4"):
            node("check-" + v, f"scripts/build-{v}.ts", "--check"); node("data-" + v, f"scripts/build-{v}.ts")
            path = M4 / f"data/{v}-manifest.json"
            if manifest_digest(path) != protocol["dataManifestCanonicalSha256"][v]: raise ValueError("protocol/data mismatch")
            manifests[v] = load(path)
        for name, expected in manifests["v4"]["files"].items():
            path = M4 / "data/generated/v4" / name
            if digest(path) != expected["sha256"] or len(read(path)) != expected["lines"]: raise ValueError("v4 data hash mismatch")
        prepare(M4 / "data/generated", manifests, out, baseline, protocol)
        write_json(out / "data-manifests.json", manifests)
        budget.step("runtime", [py, "-c", "import torch,transformers,peft,llama_cpp; "
            "assert torch.cuda.is_available() and torch.cuda.get_device_properties(0).total_memory>=22*1024**3; "
            "assert torch.__version__.split('+')[0]=='2.8.0' and transformers.__version__=='5.20.1'; "
            "assert peft.__version__=='0.21.2' and llama_cpp.__version__=='0.3.36'; print(torch.cuda.get_device_name(0))"])
        with tarfile.open(archive) as tar: tar.extractall(out / "src", filter="data")
        converter = out / "src/llama_cpp_python-0.3.36/vendor/llama.cpp"
        def predict(name, flag, model):
            inp = "all-eval" if name == "C" else "enum-eval"
            python(name, "train/predict.py", flag, model, "--tokenizer", cache / "base", "--input", out / f"{inp}.jsonl",
                "--out", out / f"{name}.jsonl", "--threads", "4", "--max-new-tokens", "256")
        predict("B", "--gguf", baseline / "gguf/parser-q8_0.gguf")
        python("train", "train/sft.py", "--base", cache / "base", "--train", M4 / "data/generated/v4/train.jsonl",
            "--dev", M4 / "data/generated/v4/dev.jsonl", "--out", out / "model", *protocol["trainingArgs"])
        predict("D-HF", "--model", out / "model/merged")
        python("export", "train/export_gguf.py", "--merged", out / "model/merged", "--llama-src", converter,
            "--out", out / "gguf", "--threads", "4", "--quantization", "q8_0")
        predict("D-F16", "--gguf", out / "gguf/parser-f16.gguf")
        for arm in ("C", "D"): predict(arm, "--gguf", out / "gguf/parser-q8_0.gguf")
        for arm in ("D-HF", "D-F16"):
            python("agreement-" + arm, "train/consistency.py", "--reference", out / f"{arm}.jsonl", "--candidate", out / "D.jsonl",
                "--out", out / f"agreement-{arm}.json", allowed=(0, 3))
        for arm in ARMS:
            partition(out, arm)
            for split in SPLITS:
                for kind, script in (("metrics", "evaluate"), ("ground", "evaluate-grounding"), ("compare", "compare-source")):
                    node(f"{kind}-{arm}-{split}", f"scripts/{script}.ts", "--gold", out / f"{split}.gold.jsonl",
                        "--pred", out / f"{arm}-{split}.jsonl", "--out", out / f"{kind}-{arm}-{split}.json")
        node("factor-summary", "scripts/summarize-v4.ts", "--out-dir", out)
        result = assess(out, protocol); write_json(out / "acceptance.json", result)
        budget.report["state"] = "development-passed-not-release" if result["developmentGatePassed"] else "below-threshold"
    except BaseException as error:
        budget.report.update(state="stopped", error=str(error)); raise
    finally:
        budget.report["finishedAt"] = time.time(); write_json(out / "run.json", budget.report)
        write_json(out / "sha256.json", {p.relative_to(out).as_posix(): digest(p) for p in sorted(out.rglob("*"))
            if p.is_file() and "src" not in p.relative_to(out).parts and p.name != "sha256.json"})
    return 0 if result["developmentGatePassed"] else 3


if __name__ == "__main__": raise SystemExit(main())
