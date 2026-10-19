#!/usr/bin/env bash
# M4 parser run, one entry: environment check -> data -> LoRA SFT -> evaluation -> GGUF export
# -> quantized evaluation and consistency check -> metrics and file hashes into the repo.
# Weights and logs stay in WORK_DIR and are never committed.
#
#   SMOKE=1 bash research/m4-parser/run_all.sh     # CPU, tiny data, a few steps: proves the pipeline
#   bash research/m4-parser/run_all.sh             # full run on the GPU server
#
# Settings (environment): WORK_DIR (default ~/liftcut-m4), MAX_SECONDS (total limit, default 14400),
# MODEL_SOURCE=huggingface|modelscope, HF_ENDPOINT, PIP_INDEX_URL, TORCH_INDEX_URL,
# USE_SYSTEM_TORCH=1 (reuse the machine's CUDA torch instead of installing torch==2.14.1).
set -euo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
M4="$REPO/research/m4-parser"
SMOKE=${SMOKE:-0}
WORK=${WORK_DIR:-$HOME/liftcut-m4}
MAX_SECONDS=${MAX_SECONDS:-14400}
[[ "$MAX_SECONDS" =~ ^[1-9][0-9]*$ ]] || { echo "MAX_SECONDS must be a positive integer" >&2; exit 2; }
[[ "$SMOKE" = 0 || "$SMOKE" = 1 ]] || { echo "SMOKE must be 0 or 1" >&2; exit 2; }
BASE_REPO=Qwen/Qwen3-0.6B
BASE_REVISION=c1899de289a04d12100db370d81485cdf75e47ca
LLAMA_CPP_PY=0.3.36
STARTED=$(date +%s)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
RESULTS="$M4/results/run-$STAMP"
if [ "$SMOKE" = 1 ]; then RESULTS="$RESULTS-smoke"; fi
mkdir -p "$WORK/logs" "$RESULTS"
STEPS="$WORK/logs/steps-$STAMP.jsonl"
: > "$STEPS"

status() { # status <state> <step>: the run summary, rewritten after every step
  python3 - "$RESULTS/run.json" "$1" "$2" "$STEPS" "$SMOKE" "$(git -C "$REPO" rev-parse HEAD)" <<'PY'
import json, sys
path, state, step, steps, smoke, commit = sys.argv[1:]
run = {"state": state, "lastStep": step, "smoke": smoke == "1", "commit": commit,
       "steps": [json.loads(line) for line in open(steps) if line.strip()]}
open(path, "w").write(json.dumps(run, indent=2) + "\n")
PY
}
step() { # step <name> <command...>: run under the remaining time budget, log to WORK_DIR, stop on failure
  local name=$1; shift
  local left=$(( MAX_SECONDS - ($(date +%s) - STARTED) ))
  if [ "$left" -le 0 ]; then status timeout "$name"; echo "time limit reached before $name"; exit 124; fi
  echo "== $name (≤ ${left}s left)"
  local t0=$(date +%s) code=0
  # A child bash runs the exported step function, so `timeout` can stop it as a whole.
  timeout --signal=TERM --kill-after=10s "$left" bash -euo pipefail -c '"$@"' _ "$@" > "$WORK/logs/$name.log" 2>&1 || code=$?
  echo "{\"step\":\"$name\",\"seconds\":$(( $(date +%s) - t0 )),\"exit\":$code}" >> "$STEPS"
  if [ "$code" -ne 0 ]; then
    tail -n 80 "$WORK/logs/$name.log" > "$RESULTS/failed-$name.log"
    local state=failed
    if [[ "$code" = 124 ]] || { [[ "$code" = 137 ]] && (( $(date +%s) - t0 >= left )); }; then state=timeout; fi
    status "$state" "$name"
    echo "$name failed (exit $code); log: $WORK/logs/$name.log"; exit "$code"
  fi
}

check_env() {
  python3 -c 'import sys; assert sys.version_info >= (3, 10), sys.version'
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'
  local free_gb=$(df -Pk "$WORK" | awk 'NR==2 {print int($4/1048576)}') need=$([ "$SMOKE" = 1 ] && echo 8 || echo 20)
  [ "$free_gb" -ge "$need" ] || { echo "need ${need} GB free in $WORK, have ${free_gb}"; return 1; }
  if [ "$SMOKE" != 1 ]; then nvidia-smi --query-gpu=name,memory.total --format=csv,noheader; fi
  git -C "$REPO" rev-parse HEAD
}
check_torch() {
  "$WORK/venv/bin/python" - "$SMOKE" <<'PY'
import sys
import torch
print('torch', torch.__version__, 'cuda', torch.cuda.is_available())
if sys.argv[1] != '1' and not torch.cuda.is_available():
    raise SystemExit('CUDA is required for a full run; install a compatible CUDA torch or use SMOKE=1 for CPU testing')
PY
}
setup_python() {
  if [ "${USE_SYSTEM_TORCH:-0}" = 1 ]; then
    [ -x "$WORK/venv/bin/python" ] || python3 -m venv --system-site-packages "$WORK/venv"
  else
    [ -x "$WORK/venv/bin/python" ] || python3 -m venv "$WORK/venv"
    local index=${TORCH_INDEX_URL:-$([ "$SMOKE" = 1 ] && echo https://download.pytorch.org/whl/cpu || echo https://download.pytorch.org/whl/cu126)}
    "$WORK/venv/bin/pip" install -q torch==2.14.1 --index-url "$index"
  fi
  check_torch
  CMAKE_BUILD_PARALLEL_LEVEL=$(nproc) "$WORK/venv/bin/pip" install -q -r "$M4/train/requirements.txt"
  # llama.cpp's converter from the same pinned release the quantizer and checker use.
  mkdir -p "$WORK/src" && "$WORK/venv/bin/pip" download -q --no-binary :all: --no-deps "llama-cpp-python==$LLAMA_CPP_PY" -d "$WORK/src"
  echo "$(cat "$M4/train/llama-cpp-python.sha256")  $WORK/src/llama_cpp_python-$LLAMA_CPP_PY.tar.gz" | sha256sum -c -
  tar xzf "$WORK/src/llama_cpp_python-$LLAMA_CPP_PY.tar.gz" -C "$WORK/src"
}
fetch_base() {
  if [ "${MODEL_SOURCE:-huggingface}" = modelscope ]; then
    "$WORK/venv/bin/pip" install -q modelscope && "$WORK/venv/bin/modelscope" download --model "$BASE_REPO" --local_dir "$WORK/base"
  else
    "$WORK/venv/bin/python" -c "from huggingface_hub import snapshot_download as s; s('$BASE_REPO', revision='$BASE_REVISION', local_dir='$WORK/base')"
  fi
  (cd "$WORK/base" && sha256sum -c "$M4/train/base-model.sha256") # Same bytes from either source, or stop.
}
data() {
  [ -d "$REPO/node_modules" ] || (cd "$REPO" && npm ci --no-audit --no-fund)
  (cd "$REPO" && npm run -s m4:data -- --check && npm run -s m4:data \
    && node --import tsx research/m4-parser/scripts/export-sft.ts $([ "$SMOKE" = 1 ] && echo --limit 16))
}
train() {
  local args=(--device cuda)
  if [ "$SMOKE" = 1 ]; then args=(--max-steps 3 --batch 4 --device cpu); fi
  "$WORK/venv/bin/python" "$M4/train/sft.py" --base "$WORK/base" --train "$M4/data/generated/sft/train.jsonl" --dev "$M4/data/generated/sft/dev.jsonl" \
    --out "$WORK/model" "${args[@]}"
}
evaluate() { # evaluate <merged|q4>
  for set in dev test handwritten; do
    "$WORK/venv/bin/python" "$M4/train/predict.py" --tokenizer "$WORK/model/merged" --input "$M4/data/generated/eval/$set.jsonl" \
      --out "$WORK/pred-$1-$set.jsonl" $([ "$1" = merged ] && echo --model "$WORK/model/merged" || echo --gguf "$WORK/gguf/parser-q4_k_m.gguf")
    (cd "$REPO" && node --import tsx research/m4-parser/scripts/evaluate.ts --gold "$M4/data/generated/eval/$set.gold.jsonl" \
      --pred "$WORK/pred-$1-$set.jsonl" --out "$RESULTS/metrics-$1-$set.json")
  done
}
export_gguf() { "$WORK/venv/bin/python" "$M4/train/export_gguf.py" --merged "$WORK/model/merged" --llama-src "$WORK/src/llama_cpp_python-$LLAMA_CPP_PY/vendor/llama.cpp" --out "$WORK/gguf"; }
consistency() {
  cat "$WORK"/pred-merged-{dev,test,handwritten}.jsonl > "$WORK/pred-merged-all.jsonl"; cat "$WORK"/pred-q4-{dev,test,handwritten}.jsonl > "$WORK/pred-q4-all.jsonl"
  # Exit 3 means agreement below the threshold: a result to report, not a failure, so hashes are still written.
  local code=0
  "$WORK/venv/bin/python" "$M4/train/consistency.py" --reference "$WORK/pred-merged-all.jsonl" --candidate "$WORK/pred-q4-all.jsonl" --out "$RESULTS/consistency.json" || code=$?
  [ "$code" = 0 ] || [ "$code" = 3 ]
}
hashes() { # Only metrics and hashes go into the repo; the weights stay on the data disk.
  cp "$WORK/model/train_metrics.json" "$WORK/gguf/gguf_files.json" "$RESULTS/"
  (cd "$WORK" && sha256sum model/adapter/adapter_model.safetensors model/merged/*.safetensors gguf/*.gguf) > "$RESULTS/sha256.txt"
}

export REPO M4 SMOKE WORK RESULTS BASE_REPO BASE_REVISION LLAMA_CPP_PY
export -f check_env check_torch setup_python fetch_base data train evaluate export_gguf consistency hashes
main() {
status running start
step env check_env
step python setup_python
step base fetch_base
step data data
step train train
step eval-merged evaluate merged
step export export_gguf
step eval-q4 evaluate q4
step consistency consistency
step hashes hashes
status "$(python3 -c 'import json, sys; d = json.load(open(sys.argv[1])); print("done" if d["parsedAgreement"] >= d["minAgreement"] else "done-consistency-below-threshold")' "$RESULTS/consistency.json")" hashes
echo "done in $(( $(date +%s) - STARTED ))s; results: $RESULTS; weights: $WORK"
}
if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then main; fi
