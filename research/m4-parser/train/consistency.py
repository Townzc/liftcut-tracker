"""Quantization check: does the Q4_K_M model give the same answers as the merged model?

Compares two prediction files item by item, as raw text and as parsed JSON, and
lists the first disagreements. The scored metrics of each file come from
evaluate.ts; this file only measures agreement. Exit code 3 when parsed
agreement is below --min-agreement, so run_all.sh marks the run without deleting anything.
"""
import argparse
import json
from pathlib import Path


def read(path):
    return {r["id"]: r["output"] for r in (json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip())}


def parsed(text):
    try:
        return json.loads(text)
    except ValueError:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reference", required=True, help="merged-model predictions")
    ap.add_argument("--candidate", required=True, help="quantized-model predictions")
    ap.add_argument("--out", required=True)
    ap.add_argument("--min-agreement", type=float, default=0.95)
    args = ap.parse_args()
    ref, cand = read(args.reference), read(args.candidate)
    ids = sorted(ref)
    same_text = sum(ref[i] == cand.get(i) for i in ids)
    same_json = sum(parsed(ref[i]) is not None and parsed(ref[i]) == parsed(cand.get(i, "")) for i in ids)
    report = {"items": len(ids), "missing": sum(i not in cand for i in ids), "sameText": same_text, "sameParsed": same_json,
              "parsedAgreement": round(same_json / max(len(ids), 1), 4), "minAgreement": args.min_agreement,
              "disagreements": [{"id": i, "reference": ref[i], "candidate": cand.get(i)} for i in ids if parsed(ref[i]) != parsed(cand.get(i, ""))][:20]}
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "disagreements"}))
    if report["parsedAgreement"] < args.min_agreement:
        raise SystemExit(3)


if __name__ == "__main__":
    main()
