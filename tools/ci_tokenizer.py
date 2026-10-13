"""CI-only cache/retry wrapper; the frozen downloader and tokenizer bytes stay unchanged."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
PROVENANCE = ROOT / "research/liftcut-agent/configs/qwen3-4b-tokenizer.json"
FETCH = ROOT / "research/liftcut-agent/fetch_tokenizer.py"


def verify(directory, provenance):
    expected = provenance["file_sha256"]
    if set(p.name for p in directory.iterdir()) != set(expected) | {"tokenizer-provenance.json"}:
        raise ValueError("tokenizer cache inventory differs")
    if json.loads((directory / "tokenizer-provenance.json").read_text()) != provenance:
        raise ValueError("tokenizer cache provenance differs")
    for name, digest in expected.items():
        if hashlib.sha256((directory / name).read_bytes()).hexdigest() != digest:
            raise ValueError(f"tokenizer cache hash differs: {name}")


def fetch_with_retry(output, run=subprocess.run, sleep=time.sleep):
    # A hash mismatch or permanent failure is never retried or accepted.
    delays = [20, 60, 120]
    for attempt in range(len(delays) + 1):
        result = run([sys.executable, str(FETCH), "--output-dir", str(output)],
                     capture_output=True, text=True, timeout=300)
        if result.returncode == 0:
            return
        error = result.stderr.strip()
        transient = any(s in error for s in (
            "HTTP Error 429:", "HTTP Error 500:", "HTTP Error 502:",
            "HTTP Error 503:", "HTTP Error 504:", "timed out"))
        if not transient or attempt == len(delays) or output.exists():
            raise RuntimeError(error or "tokenizer fetch failed")
        print(f"Transient public tokenizer fetch failure; retry in {delays[attempt]}s", flush=True)
        sleep(delays[attempt])


def prepare(output, cache, provenance, fetch=fetch_with_retry):
    if output.exists():
        raise ValueError("output directory already exists")
    output.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists():
        verify(cache, provenance)  # Cached data is never trusted solely by the cache key.
    else:
        cache.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=cache.parent) as tmp:
            download = Path(tmp) / "download"
            fetch(download)
            verify(download, provenance)
            shutil.copytree(download, cache)
    shutil.copytree(cache, output)
    verify(output, provenance)
    print("Verified four pinned public tokenizer files; no model weights or inference.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.output_dir, args.cache_dir, json.loads(PROVENANCE.read_text()))


if __name__ == "__main__":
    main()
