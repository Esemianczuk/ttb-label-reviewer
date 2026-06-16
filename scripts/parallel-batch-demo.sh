#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv}"
LOG_DIR="${TTB_LOG_DIR:-$ROOT_DIR/logs/parallel-batch}"
mkdir -p "$LOG_DIR"

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null || nvm install 20 >/dev/null
fi

command -v npm >/dev/null 2>&1 || {
  echo "parallel-batch-demo: npm is required. Install Node 20+ or enable nvm first." >&2
  exit 1
}

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip >/dev/null

if ! python - <<'PY' >/dev/null 2>&1
import fastapi, sqlalchemy, uvicorn, httpx, ttb_worker, ttb_validation
PY
then
  echo "Installing backend runtime dependencies..."
  python -m pip install -r requirements-base.txt
fi

PADDLE_REQUIREMENTS="${TTB_PADDLE_REQUIREMENTS:-requirements.txt}"
if [[ "${TTB_PADDLE_RUNTIME:-cpu}" == "cuda" ]]; then
  PADDLE_REQUIREMENTS="${TTB_PADDLE_REQUIREMENTS:-requirements-cuda-cu126.txt}"
fi

if ! python - <<'PY' >/dev/null 2>&1
import paddleocr, paddle, PIL
PY
then
  echo "Installing PaddleOCR runtime dependencies from $PADDLE_REQUIREMENTS..."
  python -m pip install -r "$PADDLE_REQUIREMENTS"
fi

if [[ ! -d "$ROOT_DIR/apps/console/node_modules" ]]; then
  echo "Installing console dependencies..."
  npm install --prefix apps/console
fi

export TTB_API_HOST="${TTB_API_HOST:-127.0.0.1}"
export TTB_API_PORT="${TTB_API_PORT:-8010}"
export VITE_TTB_BATCH_CONCURRENCY="${VITE_TTB_BATCH_CONCURRENCY:-2}"
export VITE_TTB_BACKEND_URL="${VITE_TTB_BACKEND_URL:-http://127.0.0.1:$TTB_API_PORT}"
PARALLEL_DIST="$ROOT_DIR/apps/console/dist-parallel-batch"
echo "Building parallel-batch console into $PARALLEL_DIST..."
npm --prefix apps/console run build -- --outDir dist-parallel-batch

export PYTHONPATH="$ROOT_DIR/apps/worker:$ROOT_DIR${PYTHONPATH:+:$PYTHONPATH}"
export TTB_PARALLEL_DATA_DIR="${TTB_PARALLEL_DATA_DIR:-$ROOT_DIR/data/parallel-batch}"
export TTB_API_DATABASE_URL="${TTB_API_DATABASE_URL:-sqlite:///$TTB_PARALLEL_DATA_DIR/api.sqlite3}"
export TTB_API_DATA_DIR="${TTB_API_DATA_DIR:-$TTB_PARALLEL_DATA_DIR}"
export TTB_API_STATIC_DIR="${TTB_API_STATIC_DIR:-$PARALLEL_DIST}"
export TTB_REQUIRE_WORKER_JOIN_TOKEN="${TTB_REQUIRE_WORKER_JOIN_TOKEN:-1}"
export TTB_WORKER_COORDINATOR="${TTB_WORKER_COORDINATOR:-http://127.0.0.1:$TTB_API_PORT}"
export TTB_WORKER_ENGINES="${TTB_WORKER_ENGINES:-paddleocr}"
export TTB_WORKER_CONCURRENCY="${TTB_WORKER_CONCURRENCY:-1}"
export TTB_PARALLEL_WORKER_COUNT="${TTB_PARALLEL_WORKER_COUNT:-2}"
export PYTHONUNBUFFERED="${PYTHONUNBUFFERED:-1}"

mkdir -p "$TTB_PARALLEL_DATA_DIR"

BACKEND_LOG="$LOG_DIR/backend.log"
BACKEND_PID=""
WORKER_PIDS=()
: >"$BACKEND_LOG"
rm -f "$LOG_DIR"/worker-*.log

cleanup() {
  local status=$?
  trap - EXIT INT TERM

  echo
  echo "Stopping parallel batch experiment..."
  for pid in "${WORKER_PIDS[@]:-}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
  for pid in "${WORKER_PIDS[@]:-}"; do
    wait "$pid" 2>/dev/null || true
  done
  if [[ -n "$BACKEND_PID" ]]; then
    wait "$BACKEND_PID" 2>/dev/null || true
  fi

  exit "$status"
}
trap cleanup EXIT INT TERM

echo "Starting isolated FastAPI backend on port $TTB_API_PORT..."
python -u -m uvicorn apps.api.app.main:app --host "$TTB_API_HOST" --port "$TTB_API_PORT" \
  > >(sed -u 's/^/[api] /' | tee -a "$BACKEND_LOG") \
  2> >(sed -u 's/^/[api] /' | tee -a "$BACKEND_LOG" >&2) &
BACKEND_PID="$!"

python - <<'PY'
import os
import time
import urllib.request

url = f"http://127.0.0.1:{os.environ['TTB_API_PORT']}/api/health"
deadline = time.time() + 30
last_error = None
while time.time() < deadline:
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            if response.status < 500:
                raise SystemExit(0)
    except Exception as error:
        last_error = error
        time.sleep(0.5)
raise SystemExit(f"Backend did not become ready at {url}: {last_error}")
PY

echo "Seeding isolated demo applications..."
python scripts/seed-backend-demo-fixtures.py

issue_join_token() {
  python - <<'PY'
import json
import os
import urllib.request

base = f"http://127.0.0.1:{os.environ['TTB_API_PORT']}"
login = urllib.request.Request(
    f"{base}/api/auth/demo-login",
    data=json.dumps({"role": "admin"}).encode("utf-8"),
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(login, timeout=10) as response:
    token = json.load(response)["token"]
join = urllib.request.Request(
    f"{base}/api/workers/join-token",
    data=json.dumps({"ttlSeconds": 86400}).encode("utf-8"),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
)
with urllib.request.urlopen(join, timeout=10) as response:
    print(json.load(response)["token"])
PY
}

for worker_index in $(seq 1 "$TTB_PARALLEL_WORKER_COUNT"); do
  worker_name="parallel-paddleocr-$worker_index"
  worker_dir="$ROOT_DIR/.worker-cache/parallel-batch/$worker_index"
  worker_log="$LOG_DIR/worker-$worker_index.log"
  mkdir -p "$worker_dir"
  join_token="$(issue_join_token)"
  echo "Starting worker $worker_name..."
  python -u -m ttb_worker \
    --coordinator "$TTB_WORKER_COORDINATOR" \
    --name "$worker_name" \
    --concurrency "$TTB_WORKER_CONCURRENCY" \
    --engines "$TTB_WORKER_ENGINES" \
    --data-dir "$worker_dir" \
    --secret-file "$worker_dir/worker-secret.txt" \
    --join-token "$join_token" \
    > >(sed -u "s/^/[worker-$worker_index] /" | tee -a "$worker_log") \
    2> >(sed -u "s/^/[worker-$worker_index] /" | tee -a "$worker_log" >&2) &
  WORKER_PIDS+=("$!")
done

DISPLAY_HOST="$TTB_API_HOST"
if [[ "$DISPLAY_HOST" == "0.0.0.0" || "$DISPLAY_HOST" == "::" ]]; then
  DISPLAY_HOST="127.0.0.1"
fi

cat <<EOF

TTB Label Reviewer parallel batch experiment is running.

Console:          http://$DISPLAY_HOST:$TTB_API_PORT/
Backend:          http://$DISPLAY_HOST:$TTB_API_PORT/api/health
Workers:          $TTB_PARALLEL_WORKER_COUNT local PaddleOCR worker process(es)
Batch slots UI:   $VITE_TTB_BATCH_CONCURRENCY concurrent application review(s)
Worker job slots: $TTB_WORKER_CONCURRENCY per worker process
Logs:             $LOG_DIR

This launcher uses isolated data under:
  $TTB_PARALLEL_DATA_DIR

It does not rebuild apps/console/dist and does not touch the hosted production service.

Benchmark this experiment with:
  node scripts/benchmark-parallel-batch.mjs --base http://127.0.0.1:$TTB_API_PORT --count 6 --parallelConcurrency $VITE_TTB_BATCH_CONCURRENCY

Press Ctrl+C to stop the backend and workers.
EOF

if command -v xdg-open >/dev/null 2>&1 && [[ "${TTB_NO_OPEN:-0}" != "1" ]]; then
  xdg-open "http://$DISPLAY_HOST:$TTB_API_PORT/" >/dev/null 2>&1 || true
fi

wait -n "$BACKEND_PID" "${WORKER_PIDS[@]}"
RUN_STATUS=$?
echo
echo "A parallel batch service exited; stopping the remaining services."
exit "$RUN_STATUS"
