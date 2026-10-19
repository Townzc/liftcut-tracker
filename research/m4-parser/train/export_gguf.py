"""Merged model -> GGUF f16 (llama.cpp's own converter) -> Q4_K_M (llama.cpp's quantizer).

The converter comes from the pinned llama-cpp-python sdist (vendor/llama.cpp), the same
llama.cpp the consistency check runs, so conversion and inference never drift apart.
"""
import argparse
import ctypes
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--merged", required=True)
    ap.add_argument("--llama-src", required=True, help="vendor/llama.cpp directory from the pinned sdist")
    ap.add_argument("--out", required=True)
    ap.add_argument("--threads", type=int, default=os.cpu_count() or 4)
    args = ap.parse_args()
    out, src = Path(args.out), Path(args.llama_src)
    out.mkdir(parents=True, exist_ok=True)
    f16, q4 = out / "parser-f16.gguf", out / "parser-q4_k_m.gguf"
    env = {**os.environ, "PYTHONPATH": str(src / "gguf-py")}
    subprocess.run([sys.executable, str(src / "convert_hf_to_gguf.py"), args.merged, "--outtype", "f16", "--outfile", str(f16)], check=True, env=env)

    import llama_cpp
    params = llama_cpp.llama_model_quantize_default_params()
    params.ftype = llama_cpp.LLAMA_FTYPE_MOSTLY_Q4_K_M
    params.nthread = args.threads
    if llama_cpp.llama_model_quantize(str(f16).encode(), str(q4).encode(), ctypes.byref(params)) != 0:
        raise SystemExit("llama_model_quantize failed")
    files = {p.name: {"bytes": p.stat().st_size, "sha256": sha256(p)} for p in (f16, q4)}
    (out / "gguf_files.json").write_text(json.dumps(files, indent=2) + "\n")
    print(json.dumps(files))


if __name__ == "__main__":
    main()
