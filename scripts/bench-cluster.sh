#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -d ".venv" ]]; then
  # shellcheck source=/dev/null
  source ".venv/bin/activate"
fi

export PYTHONPATH="$ROOT_DIR/apps/api:$ROOT_DIR/apps/worker:$ROOT_DIR${PYTHONPATH:+:$PYTHONPATH}"
RESULTS_DIR="${TTB_BENCHMARK_RESULTS_DIR:-$ROOT_DIR/benchmarks/results}"
BACKEND_URL="${TTB_BENCH_BACKEND_URL:-${TTB_WORKER_COORDINATOR:-http://127.0.0.1:8000}}"

mkdir -p "$RESULTS_DIR"

python -m apps.api.app.core.benchmarking \
  --modes cluster \
  --counts 1 10 50 \
  --results-dir "$RESULTS_DIR" \
  --backend-url "$BACKEND_URL" \
  --label "${TTB_BENCH_LABEL:-cluster benchmark}"

echo "Cluster benchmark results saved under $RESULTS_DIR"
echo "Runs are marked skipped when no eligible workers are available at $BACKEND_URL."
