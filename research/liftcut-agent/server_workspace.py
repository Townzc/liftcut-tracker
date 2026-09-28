"""Portable AutoDL workspace: immutable Git checkouts and explicit artifact manifests.

No credentials, model downloads, package installs, training or shutdown actions.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import subprocess
import sys

REMOTE = "https://github.com/Townzc/liftcut-tracker.git"
DIRECTORIES = ("code", "cache/huggingface", "cache/pip", "data", "runs", "envs", "manifests", "backups")
ARTIFACT_ROOTS = {"data", "runs"}
PACKAGES = ("torch", "transformers", "tokenizers", "jinja2", "accelerate", "peft", "bitsandbytes")


def command(args, cwd=None, timeout=120):
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    result = subprocess.run(args, cwd=cwd, env=env, text=True, encoding="utf-8",
                            errors="replace", capture_output=True, timeout=timeout)
    if result.returncode:
        # Do not echo arbitrary subprocess stderr (it may contain access URLs).
        raise ValueError(f"{args[0]} failed with exit {result.returncode}")
    return result.stdout.strip()


def commit_id(value):
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError("commit must be a full lowercase 40-character Git SHA")
    return value


def workspace_root(value):
    path = Path(value).expanduser().absolute()
    if not path.is_absolute() or path == Path(path.anchor):
        raise ValueError("use a dedicated workspace directory")
    # Reject symlink components, including a symlink supplied as the root.
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError("workspace path must not traverse symlinks")
    return path.resolve()


def contained(root, relative):
    root = workspace_root(root)
    path = PurePosixPath(relative)
    if not relative or path.is_absolute() or ".." in path.parts or "\\" in relative or ":" in relative:
        raise ValueError("expected a relative POSIX path within the workspace")
    candidate = root.joinpath(*path.parts)
    if any(p.is_symlink() for p in (candidate, *candidate.parents) if p != root.parent):
        raise ValueError("symlinks are not portable artifacts")
    if not candidate.resolve().is_relative_to(root):
        raise ValueError("path escaped workspace")
    return candidate


def dump_new(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(payload, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_checkout(root, commit):
    checkout = contained(root, f"code/{commit_id(commit)}")
    if command(["git", "rev-parse", "--show-toplevel"], checkout).replace("\\", "/") != checkout.as_posix():
        raise ValueError("checkout is not an independent Git repository")
    if command(["git", "remote", "get-url", "origin"], checkout) != REMOTE:
        raise ValueError("unexpected Git origin")
    if command(["git", "rev-parse", "HEAD"], checkout) != commit:
        raise ValueError("checkout revision mismatch")
    if command(["git", "status", "--porcelain", "--untracked-files=all"], checkout):
        raise ValueError("checkout has changes; preserve them on a local work branch before continuing")
    # symbolic-ref exits 1 for the required detached HEAD.
    branch = subprocess.run(["git", "symbolic-ref", "-q", "HEAD"], cwd=checkout, capture_output=True)
    if branch.returncode != 1:
        raise ValueError("experiment checkout must have detached HEAD")
    return checkout


def prepare(root, commit):
    commit_id(commit)
    root.mkdir(parents=True, exist_ok=True)
    for name in DIRECTORIES:
        contained(root, name).mkdir(parents=True, exist_ok=True)
    checkout = contained(root, f"code/{commit}")
    if not checkout.exists():
        command(["git", "-c", "credential.helper=", "clone", "--no-checkout", REMOTE, str(checkout)], timeout=180)
        command(["git", "checkout", "--detach", commit], checkout)
    check_checkout(root, commit)
    command(["git", "config", "credential.helper", ""], checkout)
    command(["git", "config", "remote.origin.pushurl", "disabled://local-authoring-only"], checkout)
    # Relative to this file, so the data directory can move between instances.
    activation = (
        '# Source this file in bash. It does not start jobs or activate a Python environment.\n'
        'export LIFTCUT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"\n'
        f'export LIFTCUT_CODE="$LIFTCUT_ROOT/code/{commit}"\n'
        'export HF_HOME="$LIFTCUT_ROOT/cache/huggingface"\n'
        'export PIP_CACHE_DIR="$LIFTCUT_ROOT/cache/pip"\n'
        'export TOKENIZERS_PARALLELISM=false\n'
    )
    contained(root, "activate.sh").write_text(activation, encoding="utf-8", newline="\n")
    return {"commit": commit, "checkout": str(checkout), "push_disabled": True,
            "activation": str(root / "activate.sh")}


def doctor(root, commit, torch_probe=False):
    check_checkout(root, commit)
    packages = {}
    for name in PACKAGES:
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    quotas = {}
    for name in ("memory.max", "cpu.max"):
        path = Path("/sys/fs/cgroup") / name
        quotas[name] = path.read_text().strip() if path.is_file() else None
    gpu = None
    if shutil.which("nvidia-smi"):
        gpu = command(["nvidia-smi", "--query-gpu=name,memory.total,memory.used,driver_version", "--format=csv"], timeout=20)
    runtime = None
    if torch_probe:
        import torch
        available = torch.cuda.is_available()
        runtime = {"cuda_build": torch.version.cuda, "cuda_available": available,
                   "bf16_supported": torch.cuda.is_bf16_supported() if available else False}
    return {"schema": "liftcut-server-doctor-v1", "observed_at_utc": datetime.now(timezone.utc).isoformat(),
            "code_commit": commit, "os": platform.system(), "python": platform.python_version(),
            "packages": packages, "cgroup_v2_limits": quotas, "gpu_csv": gpu,
            "data_disk_free_bytes": shutil.disk_usage(root).free, "torch_runtime": runtime,
            "scope": "Environment inspection only; no inference, training or API requests"}


def artifact_files(root, selections):
    root = workspace_root(root)
    files = {}
    for relative in selections:
        path = contained(root, relative)
        if PurePosixPath(relative).parts[0] not in ARTIFACT_ROOTS:
            raise ValueError("select only explicitly reviewed files under data/ or runs/")
        candidates = sorted(path.rglob("*")) if path.is_dir() else [path]
        if not path.exists():
            raise ValueError("artifact selection does not exist")
        for item in candidates:
            name = item.relative_to(root).as_posix()
            contained(root, name)  # Reject symlink directories as well as files.
            if item.is_dir():
                continue
            if not item.is_file():
                raise ValueError("artifact must be a regular file")
            if any(part.startswith(".") for part in PurePosixPath(name).parts):
                raise ValueError("hidden files are excluded from handoff manifests")
            files[name] = {"bytes": item.stat().st_size, "sha256": sha256(item)}
    if not files:
        raise ValueError("no artifact files selected")
    return files


def snapshot(root, commit, selections):
    check_checkout(root, commit)
    return {"schema": "liftcut-handoff-v1", "created_at_utc": datetime.now(timezone.utc).isoformat(),
            "code_remote": REMOTE, "code_commit": commit, "selections": selections,
            "files": artifact_files(root, selections),
            "scope": "File integrity manifest, not an off-instance backup; no credentials or model cache"}


def verify(root, manifest):
    if manifest.get("schema") != "liftcut-handoff-v1" or manifest.get("code_remote") != REMOTE:
        raise ValueError("unknown handoff manifest")
    check_checkout(root, manifest["code_commit"])
    actual = artifact_files(root, manifest["selections"])
    if actual != manifest["files"]:
        raise ValueError("artifact mismatch: files missing, added, resized or changed")
    return {"verified": True, "files": len(actual), "code_commit": manifest["code_commit"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    sub = parser.add_subparsers(dest="mode", required=True)
    for mode in ("prepare", "doctor", "snapshot"):
        child = sub.add_parser(mode)
        child.add_argument("--commit", required=True)
        if mode in {"doctor", "snapshot"}:
            child.add_argument("--output", type=Path, required=True)
        if mode == "doctor":
            child.add_argument("--torch", action="store_true")
        if mode == "snapshot":
            child.add_argument("--include", action="append", required=True)
    sub.add_parser("verify").add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    try:
        root = workspace_root(args.root)
        if args.mode == "prepare":
            result = prepare(root, args.commit)
        elif args.mode == "doctor":
            result = doctor(root, args.commit, args.torch)
        elif args.mode == "snapshot":
            result = snapshot(root, args.commit, args.include)
        else:
            result = verify(root, json.loads(args.manifest.read_text(encoding="utf-8")))
        if hasattr(args, "output"):
            dump_new(args.output, result)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
