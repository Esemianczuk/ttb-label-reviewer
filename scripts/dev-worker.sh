#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PYTHONPATH="$ROOT_DIR/apps/worker:$ROOT_DIR${PYTHONPATH:+:$PYTHONPATH}"
export TTB_WORKER_COORDINATOR="${TTB_WORKER_COORDINATOR:-http://127.0.0.1:8000}"
export TTB_WORKER_DATA_DIR="${TTB_WORKER_DATA_DIR:-$ROOT_DIR/.worker-cache}"
export TTB_WORKER_SECRET_FILE="${TTB_WORKER_SECRET_FILE:-$TTB_WORKER_DATA_DIR/worker-secret.txt}"
export TTB_WORKER_ENGINES="${TTB_WORKER_ENGINES:-null,tesseract}"

EXTRA_ARGS=()
if [[ -n "${TTB_WORKER_JOIN_TOKEN:-}" ]]; then
  EXTRA_ARGS+=(--join-token "$TTB_WORKER_JOIN_TOKEN")
fi
if [[ -n "${TTB_WORKER_SECRET:-}" ]]; then
  EXTRA_ARGS+=(--worker-secret "$TTB_WORKER_SECRET")
fi

echo "Worker coordinator: $TTB_WORKER_COORDINATOR"
echo "Worker engines:     $TTB_WORKER_ENGINES"
if [[ -z "${TTB_WORKER_JOIN_TOKEN:-}" && -z "${TTB_WORKER_SECRET:-}" && ! -f "$TTB_WORKER_SECRET_FILE" ]]; then
  echo "Worker join token:  not set; issue one from /api/cluster/join-token for first registration."
fi

python -m ttb_worker \
  --coordinator "$TTB_WORKER_COORDINATOR" \
  --name "${TTB_WORKER_NAME:-auto}" \
  --concurrency "${TTB_WORKER_CONCURRENCY:-auto}" \
  --engines "$TTB_WORKER_ENGINES" \
  --data-dir "$TTB_WORKER_DATA_DIR" \
  --secret-file "$TTB_WORKER_SECRET_FILE" \
  "${EXTRA_ARGS[@]}" \
  "$@"
