"""Create a portable D2 bundle and launch script locally; no network or GPU."""
import argparse
import json
from pathlib import Path
import re
import shlex
import shutil
import tarfile

from d2_execution import ROOT, REVIEWED, read, verify_plan
from prepare_counterfactual_diagnostics import load_tokenizer
from server_workspace import command, dump_new, sha256


def stage(output, prepared, tokenizer, commit, source_ref, opening_id, base_commit=None):
    if output.exists() or not re.fullmatch(r"[A-Za-z0-9_-]+", opening_id):
        raise ValueError("fresh stage and simple unique opening ID required")
    if not re.fullmatch(r"[0-9a-f]{40}", commit) or command(["git", "rev-parse", source_ref], ROOT) != commit:
        raise ValueError("source ref must resolve to the exact checked commit")
    if command(["git", "status", "--porcelain"], ROOT) or command(["git", "diff", commit, "--", "."], ROOT):
        raise ValueError("clean checkout matching the checked research source tree required")
    plan = verify_plan(prepared)
    load_tokenizer(tokenizer)
    if base_commit is not None:
        if (not re.fullmatch(r"[0-9a-f]{40}", base_commit) or base_commit == commit
                or command(["git", "merge-base", base_commit, commit], ROOT) != base_commit):
            raise ValueError("delta bundle base must be an exact ancestor")
    output.mkdir(parents=True, exist_ok=False)
    # One explicit ref only; no credentials and no unrelated refs in the bundle.
    command(["git", "bundle", "create", str((output / "code.bundle").resolve()), source_ref,
             *(["^" + base_commit] if base_commit else [])], ROOT)
    command(["git", "bundle", "verify", str((output / "code.bundle").resolve())], ROOT)
    for name in ("d2_setup.py", "shutdown_guard.py", "d2_bundle.py"):
        shutil.copyfile(ROOT / name, output / name)
    files = {}
    with tarfile.open(output / "assets.tar.gz", "w:gz") as tar:
        for label, directory in (("prepared", prepared), ("tokenizer", tokenizer)):
            for path in sorted(directory.iterdir()):
                if not path.is_file() or path.is_symlink():
                    raise ValueError("regular flat pinned assets only")
                name = label + "/" + path.name
                files[name] = {"bytes": path.stat().st_size, "sha256": sha256(path)}
                tar.add(path, arcname=name, recursive=False)
    dump_new(output / "asset-index.json", files)
    persist = "/root/autodl-tmp/liftcut"
    remote_stage = f"{persist}/staging/d2-{opening_id}"
    checkout = f"{persist}/code/{commit}"
    data = f"{persist}/data/d2-{opening_id}"
    ops = f"{persist}/runs/d2-ops-{opening_id}"
    run = f"{persist}/runs/d2-run-{opening_id}"
    python = f"{persist}/envs/qwen-pilot-py312/bin/python"
    model = f"{persist}/cache/huggingface/hub/models--Qwen--Qwen3-4B-Instruct-2507/snapshots/cdbee75f17c01a7cc42f958dc650907174af0554"
    argv = [python, checkout + "/research/liftcut-agent/d2_setup.py", "--ops-dir", ops,
        "--expected-code-commit", commit, "--model-dir", model, "--model-manifest", persist + "/data/qwen-model-manifest.json",
        "--prepared-dir", data + "/prepared", "--tokenizer-dir", data + "/tokenizer",
        "--adapters-root", persist + "/runs/state-coverage-v1-20260929/training", "--output-dir", run]
    q = shlex.quote
    # The trap handles setup failures promptly; the already-armed independent
    # guard remains the backstop if SSH dies before or during this shell.
    script = "\n".join([
        "#!/usr/bin/env bash", "set -euo pipefail",
        "# Run only AFTER the setup guard is observed armed. No downloads/installs.",
        f"cd {q(remote_stage)}", f"PY={q(python)}",
        'on_error() { "$PY" -c "from pathlib import Path; import subprocess; from shutdown_guard import shutdown_command; subprocess.run(shutdown_command(Path(\'/usr/bin/shutdown\')), capture_output=True, timeout=30)"; }',
        "trap on_error ERR",
        f"test -s {q(ops + '/setup-guard.jsonl')}",
        '"$PY" -c \'import shutil; assert shutil.disk_usage("/root/autodl-tmp").free >= 3000000000, "less than 3GB free; no expansion"\'',
        f"test ! -e {q(checkout)}", f"test ! -e {q(data)}",
        "sha256sum --check SHA256SUMS", f"git clone --no-checkout code.bundle {q(checkout)}",
        f"git -C {q(checkout)} checkout --detach {q(commit)}",
        f"git -C {q(checkout)} remote set-url origin https://github.com/Townzc/liftcut-tracker.git",
        f"mkdir -p {q(data)}", f"tar -xzf assets.tar.gz -C {q(data)}",
        " ".join(q(v) for v in argv), "trap - ERR", ""])
    if base_commit:
        # The maintained launcher validates/resumes delta assets and preserves
        # original deadlines. A full-clone legacy shell cannot apply this bundle.
        script = '#!/usr/bin/env bash\necho "Use checked launch_d2_remote.py for this delta stage" >&2\nexit 2\n'
    (output / "launch.sh").write_text(script, encoding="utf-8", newline="\n")
    sums = {p.name: {"bytes": p.stat().st_size, "sha256": sha256(p)} for p in sorted(output.iterdir()) if p.is_file()}
    (output / "SHA256SUMS").write_text("".join(v["sha256"] + "  " + k + "\n" for k, v in sums.items()), encoding="utf-8", newline="\n")
    instructions = {"execution_commit": commit, "remote_stage": remote_stage, "remote_ops": ops, "remote_run": run,
        "files": sums, "execution_plan_sha256": sha256(REVIEWED), "bundle_base_commit": base_commit,
        "first_upload_only": ["d2_setup.py", "shutdown_guard.py"],
        "arm_argv_replace_boot_with_actual_observation": [python, remote_stage + "/d2_setup.py", "--arm-only", "--ops-dir", ops,
                                                          "--booted-at", "ACTUAL_BOOT_PROXY_WITH_UTC_OFFSET"],
        "then": "Use checked launch_d2_remote.py with a new opening ID; it arms guards before transfer and shares one connection with collection. Delta stages require the exact existing clean base checkout.",
        "budget": plan["budget"], "server_state_verified": False, "new_model_calls": 0}
    dump_new(output / "stage.json", instructions)
    return instructions


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ("output-dir", "prepared-dir", "tokenizer-dir"):
        parser.add_argument("--" + name, type=Path, required=True)
    for name in ("execution-commit", "source-ref", "opening-id"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--base-commit", help="Existing immutable server checkout; create a small incremental bundle")
    args = parser.parse_args()
    result = stage(args.output_dir, args.prepared_dir, args.tokenizer_dir, args.execution_commit, args.source_ref, args.opening_id, args.base_commit)
    print(json.dumps({k: result[k] for k in ("execution_commit", "remote_ops", "remote_run", "budget", "server_state_verified")}, indent=2))
