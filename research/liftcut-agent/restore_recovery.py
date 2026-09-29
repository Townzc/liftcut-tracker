"""Verify and restore one hash-indexed run archive into a fresh local directory."""

import argparse
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile

from server_workspace import dump_new, sha256


def restore(archive, output, expected_sha256):
    if output.exists():
        raise ValueError("restore destination must be new")
    if sha256(archive) != expected_sha256:
        raise ValueError("archive SHA256 mismatch")
    with tarfile.open(archive, "r:gz") as tar:
        members = tar.getmembers()
        names = set()
        roots = set()
        for member in members:
            path = PurePosixPath(member.name)
            if (path.is_absolute() or ".." in path.parts or "\\" in member.name or ":" in member.name
                    or not path.parts or not (member.isfile() or member.isdir()) or member.name in names):
                raise ValueError("unsafe or duplicate archive member")
            names.add(member.name)
            roots.add(path.parts[0])
        if len(roots) != 1:
            raise ValueError("archive must contain exactly one run root")
        root_name = next(iter(roots))
        inventory_name = root_name + "/backup-inventory.json"
        if inventory_name not in names:
            raise ValueError("missing backup inventory")
        inventory = json.load(tar.extractfile(inventory_name))
        listed = inventory["files"]
        relative_names = [entry["path"] for entry in listed]
        if len(set(relative_names)) != len(relative_names):
            raise ValueError("duplicate inventory entry")
        actual_files = {m.name for m in members if m.isfile()}
        if actual_files != {inventory_name, *(root_name + "/" + name for name in relative_names)}:
            raise ValueError("inventory does not exactly cover archive files")
        output.mkdir(parents=True, exist_ok=False)
        for member in members:
            target = output.joinpath(*PurePosixPath(member.name).parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source, target.open("xb") as dest:
                    shutil.copyfileobj(source, dest)
    run = output / root_name
    for entry in listed:
        path = run / entry["path"]
        if path.stat().st_size != entry["bytes"] or sha256(path) != entry["sha256"]:
            raise ValueError("restored artifact size/hash mismatch")
    receipt = {"archive": archive.name, "bytes": archive.stat().st_size, "sha256": expected_sha256,
               "verified_files": len(listed), "all_inventory_files_verified": True, "run_directory": str(run)}
    dump_new(output / "restore-receipt.json", receipt)
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    args = parser.parse_args()
    print(json.dumps(restore(args.archive, args.output_dir, args.sha256), indent=2))
