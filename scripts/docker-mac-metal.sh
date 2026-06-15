#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "docker-mac-metal.sh is intended for macOS. Use scripts/docker-demo.sh on Linux." >&2
  exit 2
fi

VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv}"
PORT="${TTB_DOCKER_API_PORT:-8000}"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.mac.yml)
API_LOG_PID=""

if ! command -v docker >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Docker is required for the macOS backend API container.

Install Docker Desktop or Colima, start it, then rerun:
  ./scripts/docker-mac-metal.sh

The worker itself runs as a native macOS process so Apple Metal/MPS can be used
by the LayoutLMv3 extractor when a promoted model is present.
EOF
  exit 2
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required. Update Docker Desktop or install the compose plugin." >&2
  exit 2
fi

resolve_python() {
  if [[ -n "${PYTHON_BIN:-}" ]]; then
    if "$PYTHON_BIN" - <<'PY'
import sys
raise SystemExit(0 if sys.version_info >= (3, 10) else 1)
PY
    then
      printf '%s\n' "$PYTHON_BIN"
      return 0
    fi
    echo "PYTHON_BIN=$PYTHON_BIN is older than Python 3.10." >&2
    exit 2
  fi

  local candidate
  for candidate in python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      if "$candidate" - <<'PY'
import sys
raise SystemExit(0 if sys.version_info >= (3, 10) else 1)
PY
      then
        printf '%s\n' "$candidate"
        return 0
      fi
    fi
  done

  cat >&2 <<'EOF'
Python 3.10+ is required for the native macOS OCR worker.

Install Python 3.11 or 3.12, for example:
  brew install python@3.12

Then rerun:
  ./scripts/docker-mac-metal.sh
EOF
  exit 2
}

PYTHON_BIN="$(resolve_python)"

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$API_LOG_PID" ]] && kill -0 "$API_LOG_PID" >/dev/null 2>&1; then
    kill "$API_LOG_PID" >/dev/null 2>&1 || true
    wait "$API_LOG_PID" 2>/dev/null || true
  fi
  echo
  echo "Stopping Docker API container..."
  "${COMPOSE[@]}" down
  exit "$status"
}
trap cleanup EXIT INT TERM

echo "Starting Docker API container for macOS Metal mode..."
"${COMPOSE[@]}" up --build -d api
"${COMPOSE[@]}" logs -f api &
API_LOG_PID="$!"

"$PYTHON_BIN" - <<'PY'
import os
import time
import urllib.request

port = os.environ.get("TTB_DOCKER_API_PORT", "8000")
url = f"http://127.0.0.1:{port}/api/health"
deadline = time.time() + 120
last_error = None
while time.time() < deadline:
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            if response.status < 500:
                raise SystemExit(0)
    except Exception as error:
        last_error = error
        time.sleep(1)
raise SystemExit(f"API did not become ready at {url}: {last_error}")
PY

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip >/dev/null

if ! python - <<'PY' >/dev/null 2>&1
import paddleocr, paddle, torch, transformers
PY
then
  echo "Installing Mac native PaddleOCR/LayoutLMv3 runtime dependencies..."
  python -m pip install -e "apps/worker[ocr,paddleocr,layoutlmv3]"
  if ! python - <<'PY' >/dev/null 2>&1
import paddle
PY
  then
    python -m pip install paddlepaddle
  fi
fi

export PYTHONPATH="$ROOT_DIR/apps/worker:$ROOT_DIR${PYTHONPATH:+:$PYTHONPATH}"
export TTB_WORKER_COORDINATOR="${TTB_WORKER_COORDINATOR:-http://127.0.0.1:$PORT}"
export TTB_WORKER_DATA_DIR="${TTB_WORKER_DATA_DIR:-$ROOT_DIR/.worker-cache}"
export TTB_WORKER_SECRET_FILE="${TTB_WORKER_SECRET_FILE:-$TTB_WORKER_DATA_DIR/worker-secret.txt}"
export TTB_WORKER_ENGINES="${TTB_WORKER_ENGINES:-paddleocr}"
export TTB_WORKER_NAME="${TTB_WORKER_NAME:-mac-metal-paddleocr}"
export TTB_WORKER_ENABLE_HEAVY_OCR="${TTB_WORKER_ENABLE_HEAVY_OCR:-1}"
export TTB_LAYOUTLMV3_REQUIRE_MODEL="${TTB_LAYOUTLMV3_REQUIRE_MODEL:-0}"

EXTRA_ARGS=()
if [[ -f "$TTB_WORKER_SECRET_FILE" ]]; then
  echo "Reusing persistent worker secret at $TTB_WORKER_SECRET_FILE"
else
  JOIN_TOKEN="$(python - <<'PY'
import json
import os
import urllib.request

base = os.environ["TTB_WORKER_COORDINATOR"].rstrip("/")
login = urllib.request.Request(
    f"{base}/api/auth/demo-login",
    data=json.dumps({"role": "admin"}).encode("utf-8"),
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(login, timeout=20) as response:
    token = json.load(response)["token"]
join = urllib.request.Request(
    f"{base}/api/workers/join-token",
    data=json.dumps({"ttlSeconds": 86400}).encode("utf-8"),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
)
with urllib.request.urlopen(join, timeout=20) as response:
    print(json.load(response)["token"])
PY
)"
  EXTRA_ARGS+=(--join-token "$JOIN_TOKEN")
fi

cat <<EOF

TTB Label Reviewer is running in macOS Metal-capable mode.

Console: http://127.0.0.1:$PORT/
API:     Docker Compose service
Worker:  native macOS process using $PYTHON_BIN and PaddleOCR; PyTorch MPS is available to a promoted LayoutLMv3 extractor.

Press Ctrl+C to stop the worker and API container.
EOF

if command -v open >/dev/null 2>&1 && [[ "${TTB_NO_OPEN:-0}" != "1" ]]; then
  open "http://127.0.0.1:$PORT/" >/dev/null 2>&1 || true
fi

python -u -m ttb_worker \
  --coordinator "$TTB_WORKER_COORDINATOR" \
  --name "$TTB_WORKER_NAME" \
  --concurrency "${TTB_WORKER_CONCURRENCY:-auto}" \
  --engines "$TTB_WORKER_ENGINES" \
  --data-dir "$TTB_WORKER_DATA_DIR" \
  --secret-file "$TTB_WORKER_SECRET_FILE" \
  "${EXTRA_ARGS[@]}"
