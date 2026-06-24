#!/usr/bin/env bash
set -euo pipefail

BASE_MODEL="${BASE_MODEL:-Qwen/Qwen2.5-7B-Instruct}"
LORA_PATH="${LORA_PATH:-outputs/liftcut-coach-qwen7b-lora}"
SERVED_NAME="${SERVED_NAME:-liftcut-coach}"
PORT="${PORT:-8000}"

vllm serve "$BASE_MODEL" \
  --enable-lora \
  --lora-modules "$SERVED_NAME=$LORA_PATH" \
  --dtype auto \
  --max-model-len 8192 \
  --port "$PORT"
