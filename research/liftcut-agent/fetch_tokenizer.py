"""Download only the four hash-pinned public tokenizer/config/license files."""

import argparse
import hashlib
import json
from pathlib import Path
import sys
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.output_dir.exists():
            raise ValueError("output directory already exists")
        provenance = json.loads((ROOT / "configs/qwen3-4b-tokenizer.json").read_text(encoding="utf-8"))
        data = {}
        for name, expected in provenance["file_sha256"].items():
            if name not in {"tokenizer.json", "tokenizer_config.json", "config.json", "LICENSE"}:
                raise ValueError("file is outside tokenizer-only allowlist")
            url = f'https://huggingface.co/{provenance["model_id"]}/resolve/{provenance["revision"]}/{name}'
            with urlopen(url, timeout=60) as response:
                content = response.read(25000001)
            if len(content) > 25000000 or hashlib.sha256(content).hexdigest() != expected:
                raise ValueError(f"download hash or size mismatch: {name}")
            data[name] = content
        args.output_dir.mkdir(parents=True, exist_ok=False)
        for name, content in data.items():
            (args.output_dir / name).write_bytes(content)
        (args.output_dir / "tokenizer-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(json.dumps({"model_id": provenance["model_id"], "revision": provenance["revision"],
                          "files": len(data), "bytes": sum(map(len, data.values())), "weights_downloaded": False}))
        return 0
    except (OSError, ValueError, KeyError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
