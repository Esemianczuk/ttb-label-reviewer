#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv}"
LOG_DIR="${TTB_LOG_DIR:-$ROOT_DIR/logs}"
mkdir -p "$LOG_DIR"

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null || nvm install 20 >/dev/null
fi

command -v npm >/dev/null 2>&1 || {
  echo "smart-demo: npm is required. Install Node 20+ or enable nvm first." >&2
  exit 1
}

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip >/dev/null

if ! python - <<'PY' >/dev/null 2>&1
import fastapi, sqlalchemy, uvicorn, httpx
PY
then
  echo "Installing backend and test support dependencies..."
  python -m pip install -r requirements-dev.txt
fi

if ! python - <<'PY' >/dev/null 2>&1
import paddleocr, PIL, transformers, torch
PY
then
  echo "Installing PaddleOCR and LayoutLMv3 runtime dependencies..."
  python -m pip install -e "apps/worker[ocr,paddleocr,layoutlmv3]"
  if ! python - <<'PY' >/dev/null 2>&1
import paddle
PY
  then
    echo "Installing CPU PaddlePaddle runtime..."
    python -m pip install paddlepaddle
  fi
fi

if [[ ! -d "$ROOT_DIR/apps/console/node_modules" ]]; then
  echo "Installing console dependencies..."
  npm install --prefix apps/console
fi

echo "Building console..."
npm --prefix apps/console run build

export PYTHONPATH="$ROOT_DIR/apps/worker:$ROOT_DIR${PYTHONPATH:+:$PYTHONPATH}"
export TTB_API_DATABASE_URL="${TTB_API_DATABASE_URL:-sqlite:///$ROOT_DIR/data/api.sqlite3}"
export TTB_API_DATA_DIR="${TTB_API_DATA_DIR:-$ROOT_DIR/data}"
export TTB_API_STATIC_DIR="${TTB_API_STATIC_DIR:-$ROOT_DIR/apps/console/dist}"
export TTB_API_HOST="${TTB_API_HOST:-127.0.0.1}"
export TTB_API_PORT="${TTB_API_PORT:-8000}"
export TTB_REQUIRE_WORKER_JOIN_TOKEN="${TTB_REQUIRE_WORKER_JOIN_TOKEN:-1}"
export TTB_LAYOUTLMV3_REQUIRE_MODEL="${TTB_LAYOUTLMV3_REQUIRE_MODEL:-0}"
export TTB_WORKER_COORDINATOR="${TTB_WORKER_COORDINATOR:-http://127.0.0.1:$TTB_API_PORT}"
export TTB_WORKER_DATA_DIR="${TTB_WORKER_DATA_DIR:-$ROOT_DIR/.worker-cache}"
export TTB_WORKER_SECRET_FILE="${TTB_WORKER_SECRET_FILE:-$TTB_WORKER_DATA_DIR/worker-secret.txt}"
export TTB_WORKER_ENGINES="${TTB_WORKER_ENGINES:-paddleocr}"
export TTB_WORKER_NAME="${TTB_WORKER_NAME:-local-paddleocr}"
export PYTHONUNBUFFERED="${PYTHONUNBUFFERED:-1}"

BACKEND_LOG="$LOG_DIR/backend.log"
WORKER_LOG="$LOG_DIR/worker.log"
BACKEND_PID=""
WORKER_PID=""
: >"$BACKEND_LOG"
: >"$WORKER_LOG"

cleanup() {
  local status=$?
  trap - EXIT INT TERM

  echo
  echo "Stopping TTB Label Reviewer..."
  if [[ -n "$WORKER_PID" ]] && kill -0 "$WORKER_PID" >/dev/null 2>&1; then
    kill "$WORKER_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "$WORKER_PID" ]]; then
    wait "$WORKER_PID" 2>/dev/null || true
  fi
  if [[ -n "$BACKEND_PID" ]]; then
    wait "$BACKEND_PID" 2>/dev/null || true
  fi

  exit "$status"
}
trap cleanup EXIT INT TERM

echo "Starting FastAPI backend..."
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

echo "Seeding backend demo applications..."
python scripts/seed-backend-demo-fixtures.py

JOIN_TOKEN="$(python - <<'PY'
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
)"

echo "Starting local PaddleOCR worker..."
python -u -m ttb_worker \
  --coordinator "$TTB_WORKER_COORDINATOR" \
  --name "$TTB_WORKER_NAME" \
  --concurrency "${TTB_WORKER_CONCURRENCY:-auto}" \
  --engines "$TTB_WORKER_ENGINES" \
  --data-dir "$TTB_WORKER_DATA_DIR" \
  --secret-file "$TTB_WORKER_SECRET_FILE" \
  --join-token "$JOIN_TOKEN" \
  > >(sed -u 's/^/[worker] /' | tee -a "$WORKER_LOG") \
  2> >(sed -u 's/^/[worker] /' | tee -a "$WORKER_LOG" >&2) &
WORKER_PID="$!"

DISPLAY_HOST="$TTB_API_HOST"
if [[ "$DISPLAY_HOST" == "0.0.0.0" || "$DISPLAY_HOST" == "::" ]]; then
  DISPLAY_HOST="127.0.0.1"
fi

cat <<EOF

TTB Label Reviewer is running.

Console:   http://$DISPLAY_HOST:$TTB_API_PORT/
Backend:   http://$DISPLAY_HOST:$TTB_API_PORT/api/health
Worker:    local PaddleOCR worker '$TTB_WORKER_NAME'
Logs:      streaming in this terminal and saved to:
           $BACKEND_LOG
           $WORKER_LOG

Backend extraction uses PaddleOCR full-image OCR. If a trained LayoutLMv3 model is staged at
models/field-extractor/layoutlmv3-cola/current, it is used; otherwise conservative weak alignment is used.

Press Ctrl+C to stop the backend and worker.
EOF

if command -v xdg-open >/dev/null 2>&1 && [[ "${TTB_NO_OPEN:-0}" != "1" ]]; then
  xdg-open "http://$DISPLAY_HOST:$TTB_API_PORT/" >/dev/null 2>&1 || true
fi

wait -n "$BACKEND_PID" "$WORKER_PID"
RUN_STATUS=$?
echo
echo "A demo service exited; stopping the remaining service."
exit "$RUN_STATUS"
