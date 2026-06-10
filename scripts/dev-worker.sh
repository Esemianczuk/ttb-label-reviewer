#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PYTHONPATH="$ROOT_DIR/apps/worker:$ROOT_DIR${PYTHONPATH:+:$PYTHONPATH}"
export TTB_WORKER_COORDINATOR="${TTB_WORKER_COORDINATOR:-http://127.0.0.1:8000}"
export TTB_WORKER_DATA_DIR="${TTB_WORKER_DATA_DIR:-$ROOT_DIR/.worker-cache}"

python -m ttb_worker \
  --coordinator "$TTB_WORKER_COORDINATOR" \
  --name "${TTB_WORKER_NAME:-auto}" \
  --concurrency "${TTB_WORKER_CONCURRENCY:-auto}" \
  --engines "${TTB_WORKER_ENGINES:-auto}" \
  --data-dir "$TTB_WORKER_DATA_DIR" \
  "$@"
