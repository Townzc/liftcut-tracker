"""Download the pinned public Qwen weights and verify Hub LFS digests; no inference."""

import argparse
import json
from pathlib import Path
import shutil

from server_workspace import dump_new, sha256

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("manifest already exists")
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(args.cache_dir).free < 20 * 1024**3:
        raise ValueError("need 20 GiB free for download and pilot outputs; do not auto-expand disk")
    pinned = json.loads((ROOT / "configs/qwen3-4b-tokenizer.json").read_text())
    from huggingface_hub import HfApi, snapshot_download
    info = HfApi().model_info(pinned["model_id"], revision=pinned["revision"], files_metadata=True, token=False)
    if info.sha != pinned["revision"]:
        raise ValueError("Hub revision mismatch")
    small = set(pinned["file_sha256"]) | {"model.safetensors.index.json", "generation_config.json"}
    files = [f for f in info.siblings if f.rfilename in small or f.rfilename.endswith(".safetensors")]
    if not any(f.rfilename.endswith(".safetensors") for f in files):
        raise ValueError("missing safetensors weights")
    path = Path(snapshot_download(pinned["model_id"], revision=pinned["revision"],
                                 cache_dir=args.cache_dir, allow_patterns=[f.rfilename for f in files],
                                 token=False, max_workers=2))
    inventory = {}
    for entry in files:
        file = path / entry.rfilename
        actual = sha256(file)
        expected = pinned["file_sha256"].get(entry.rfilename)
        if entry.lfs:
            expected = entry.lfs.sha256
        if file.stat().st_size != entry.size or (expected and actual != expected):
            raise ValueError("model file integrity mismatch")
        if entry.rfilename.endswith(".safetensors") and not expected:
            raise ValueError("missing upstream weight digest")
        inventory[entry.rfilename] = {"bytes": entry.size, "sha256": actual, "upstream_sha256": expected}
    dump_new(args.output, {"model_id": pinned["model_id"], "revision": pinned["revision"],
                           "files": inventory, "weights_downloaded": True,
                           "scope": "Public pinned weights; LFS hashes checked; no training"})
    print(json.dumps({"snapshot": str(path), "files": len(files), "bytes": sum(f.size for f in files)}))


if __name__ == "__main__":
    main()
