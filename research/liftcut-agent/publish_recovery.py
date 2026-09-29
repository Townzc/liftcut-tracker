"""Copy an audited synthetic run to a new public report directory, without weights.

Only named JSON/JSONL logs and metadata are selected. This writes local files;
it does not push to GitHub, upload artifacts, or execute models.
"""

import argparse
import json
import math
from pathlib import Path
import shutil
import struct

from audit_recovery import audit
from audit_identifier_probe import audit_probe
from server_workspace import dump_new, sha256


def adapter_metadata(path):
    with path.open("rb") as stream:
        header_bytes = struct.unpack("<Q", stream.read(8))[0]
        if not 0 < header_bytes < 4 * 1024 * 1024:
            raise ValueError("unexpected safetensors metadata size")
        header = json.loads(stream.read(header_bytes))
    tensors = [value for name, value in header.items() if name != "__metadata__"]
    return {"adapter_bytes": path.stat().st_size, "sha256": sha256(path),
            "tensor_count": len(tensors), "parameter_count": sum(math.prod(t["shape"]) for t in tensors),
            "dtypes": sorted({t["dtype"] for t in tensors})}


def summary_markdown(original, probe):
    lines = ["# Recovery SFT pilot: diagnostic evidence", "",
        "**Validity correction:** original record/memory IDs contain category hints. Original scores",
        "are contaminated diagnostics. The opaque-ID probe reuses the same tasks and models",
        "trained with hinted IDs; it is not corrected training or fresh held-out evaluation.", "",
        "| Arm | Original success | Opaque success | Opaque clean | Opaque blocked writes | Opaque calls |",
        "| --- | ---: | ---: | ---: | ---: | ---: |"]
    for arm in ("unadapted", "clean", "mixed"):
        old = original["arms"][arm]
        passed, total = sum(s["passed"] for s in old.values()), sum(s["total"] for s in old.values())
        new = probe["arms"][arm]
        lines.append(f"| {arm} | {passed}/{total} | {new['passed']}/{new['total']} | "
                     f"{new['clean_completions']} | {new['blocked_write_attempts']} | {new['requests']} |")
    lines.extend(["", "Both SFT arms: one seed, 38 optimizer steps, 300 decisions and 12,758 supervised",
        "tokens each. Targets and sampler positions match; context token counts differ.", "",
        "The original raw `comparison.json` and manifests retain pre-discovery scope strings.",
        "The validity correction above and the newer audit files supersede those descriptions.", "",
        "- `backed-up-adapter-audit.json`: actual off-instance weight files were checked before publication.",
        "- `public-log-audit.json`: reproducible log/config/hash agreement; weights are intentionally omitted.",
        "- `identifier-probe-audit.json`: all 72 opaque-ID episodes replay and paired changes are recorded.",
        "- `publication-manifest.json`: exact whitelist of copied synthetic artifacts.", "",
        "Audits establish recorded-log consistency, not independent hardware or billing provenance.",
        "[Full analysis and next experiment](../../../../docs/research/2026-09-29-recovery-results.md)", ""])
    return "\n".join(lines)


def publish(run, prepared, output):
    if output.exists():
        raise ValueError("public report directory already exists")
    verified = audit(run, prepared)  # Includes actual backed-up adapter file hashes.
    probe = audit_probe(run)
    relative = ["window-status.json", "boot-observation.json", "recovery-doctor.json",
                "recovery-server-tests.log", "installed-packages.txt", "comparison.json",
                "deadline-guard.jsonl", "backup-inventory.json"]
    for arm in ("clean", "mixed"):
        relative.extend(f"training/{arm}/{name}" for name in
                        ("manifest.json", "report.json", "training.jsonl", "memory-probe.json", "final/adapter_config.json"))
    for arm in ("unadapted", "clean", "mixed"):
        relative.extend(f"evaluation/{arm}/{name}" for name in
                        ("manifest.json", "config.json", "report.json", "episodes.jsonl", "generations.jsonl"))
        relative.extend(f"identifier-probe/{arm}/{name}" for name in
                        ("manifest.json", "config.json", "report.json", "episodes.jsonl", "generations.jsonl"))
    relative.extend(f"identifier-probe/{name}" for name in ("manifest.json", "status.json",
                    "cases/manifest.json", "cases/train.jsonl", "cases/dev.jsonl", "cases/test.jsonl"))
    for name in relative:
        source = run / name
        if not source.is_file() or source.is_symlink():
            raise ValueError(f"missing or linked public artifact: {name}")
    output.mkdir(parents=True, exist_ok=False)
    for name in relative:
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(run / name, target)
    dump_new(output / "backed-up-adapter-audit.json", verified)
    dump_new(output / "adapter-metadata.json", {arm: adapter_metadata(run / "training" / arm / "final/adapter_model.safetensors")
                                               for arm in ("clean", "mixed")})
    public = audit(output, prepared, verify_weights=False)
    dump_new(output / "public-log-audit.json", public)
    dump_new(output / "identifier-probe-audit.json", probe)
    (output / "README.md").write_text(summary_markdown(public, probe), encoding="utf-8", newline="\n")
    dump_new(output / "publication-manifest.json", {
        "scope": "Synthetic diagnostic records; original identifier leakage disclosed; adapter weights excluded",
        "copied_files": {name: sha256(output / name) for name in relative},
        "adapter_files_verified_before_publication": True,
        "public_audit_verifies_adapter_metadata_only": True,
        "no_independent_hardware_provenance": True})
    return public


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--prepared-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    result = publish(args.run_dir, args.prepared_dir, args.output_dir)
    print({"public_report_written": True, "paired": result["paired_clean_mixed"]})
