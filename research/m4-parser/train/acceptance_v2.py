"""Frozen candidate gates; passing never enables a product feature."""
import json
from pathlib import Path

GATES = {"rawAgreement": .95, "challengeExact": .90, "challengeSchema": .99, "challengeCoverage": .90,
         "rawChallengeInvented": 0, "guardedUnsafe": 0, "truncated": 0}


def assess(out, data):
    out, data = Path(out), Path(data)
    load = lambda name: json.loads((out / name).read_text(encoding="utf-8"))
    coverage, safety = {}, {}
    for split in ("dev-eval", "challenge", "old-test", "handwritten"):
        gold = [json.loads(line) for line in (data / f"{split}.gold.jsonl").read_text(encoding="utf-8").splitlines()]
        report = load(f"ground-quant-{split}.json")
        actionable = sum(r["label"]["intent"] != "clarify" for r in gold)
        if not actionable or report["guarded"]["total"] != len(gold): raise ValueError("grounding denominator mismatch")
        coverage[split] = {"correctAccepted": report["accepted"] - report["unsafeAccepted"], "actionable": actionable,
                           "rate": (report["accepted"] - report["unsafeAccepted"]) / actionable}
        safety[split] = {"unsafeAccepted": report["unsafeAccepted"], "invented": report["guarded"]["invented"]}
    agreements = {name: load(f"agreement-{name}.json") for name in ("merged", "f16")}
    raw = load("metrics-quant-challenge.json")
    predictions = [json.loads(line) for line in (out / "quant.jsonl").read_text(encoding="utf-8").splitlines()]
    audits = [load(name + ".jsonl.audit.json") for name in ("old-new-prompt", "merged", "f16", "quant")]
    checks = {
        "sameInputTokens": all(a["items"] == len(predictions) and a["inputSha256"] == audits[0]["inputSha256"] and
                               a["tokenIdsSha256"] == audits[0]["tokenIdsSha256"] for a in audits),
        "rawAgreement": all(a["items"] == len(predictions) and a["missing"] == 0 and
                            a["sameParsed"] / max(a["items"], 1) >= GATES["rawAgreement"] for a in agreements.values()),
        "noTruncation": all(r.get("finishReason") == "stop" for r in predictions),
        "challengeExact": raw["exactRate"] >= GATES["challengeExact"],
        "challengeSchema": raw["schemaValidRate"] >= GATES["challengeSchema"],
        "challengeNoInvented": raw["invented"] == GATES["rawChallengeInvented"],
        "guardedSafety": all(s["unsafeAccepted"] == s["invented"] == 0 for s in safety.values()),
        "challengeCoverage": coverage["challenge"]["rate"] >= GATES["challengeCoverage"],
    }
    return {"candidatePassed": all(checks.values()), "checks": checks, "coverage": coverage, "safety": safety,
            "releaseReady": False, "pending": ["independent natural-language acceptance", "native integration and real-device acceptance"],
            "note": "Old tests are diagnostic. No automatic activation. Raw agreement is before grounding."}
