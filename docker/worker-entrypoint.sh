#!/usr/bin/env bash
set -euo pipefail

cd /app

export TTB_WORKER_COORDINATOR="${TTB_WORKER_COORDINATOR:-http://api:8000}"
export TTB_WORKER_DATA_DIR="${TTB_WORKER_DATA_DIR:-/worker-cache}"
export TTB_WORKER_SECRET_FILE="${TTB_WORKER_SECRET_FILE:-$TTB_WORKER_DATA_DIR/worker-secret.txt}"
export TTB_WORKER_ENGINES="${TTB_WORKER_ENGINES:-paddleocr}"
export TTB_WORKER_NAME="${TTB_WORKER_NAME:-compose-paddleocr}"
export TTB_WORKER_CONCURRENCY="${TTB_WORKER_CONCURRENCY:-auto}"
export TTB_WORKER_ENABLE_HEAVY_OCR="${TTB_WORKER_ENABLE_HEAVY_OCR:-1}"
export TTB_LAYOUTLMV3_REQUIRE_MODEL="${TTB_LAYOUTLMV3_REQUIRE_MODEL:-0}"
export PYTHONUNBUFFERED="${PYTHONUNBUFFERED:-1}"
if command -v python >/dev/null 2>&1; then
  PYTHON_BIN=python
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN=python3
else
  echo "[worker] Python runtime was not found in PATH." >&2
  exit 127
fi

mkdir -p "$TTB_WORKER_DATA_DIR"

"$PYTHON_BIN" - <<'PY'
import os
import time
import urllib.request

base = os.environ["TTB_WORKER_COORDINATOR"].rstrip("/")
deadline = time.time() + int(os.environ.get("TTB_WORKER_WAIT_SECONDS", "120"))
last_error = None
while time.time() < deadline:
    try:
        with urllib.request.urlopen(f"{base}/api/health", timeout=3) as response:
            if response.status < 500:
                raise SystemExit(0)
    except Exception as error:
        last_error = error
        time.sleep(1)
raise SystemExit(f"Coordinator did not become ready at {base}/api/health: {last_error}")
PY

EXTRA_ARGS=()
if [[ -n "${TTB_WORKER_SECRET:-}" ]]; then
  EXTRA_ARGS+=(--worker-secret "$TTB_WORKER_SECRET")
elif [[ -f "$TTB_WORKER_SECRET_FILE" ]]; then
  echo "[worker] Reusing persistent worker secret at $TTB_WORKER_SECRET_FILE"
else
  echo "[worker] Requesting first-registration join token..."
  JOIN_TOKEN="$("$PYTHON_BIN" - <<'PY'
import json
import os
import urllib.request

base = os.environ["TTB_WORKER_COORDINATOR"].rstrip("/")
ttl = int(os.environ.get("TTB_WORKER_JOIN_TTL_SECONDS", "86400"))
login = urllib.request.Request(
    f"{base}/api/auth/demo-login",
    data=json.dumps({"role": "admin"}).encode("utf-8"),
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(login, timeout=20) as response:
    token = json.load(response)["token"]
join = urllib.request.Request(
    f"{base}/api/workers/join-token",
    data=json.dumps({"ttlSeconds": ttl}).encode("utf-8"),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
)
with urllib.request.urlopen(join, timeout=20) as response:
    print(json.load(response)["token"])
PY
)"
  EXTRA_ARGS+=(--join-token "$JOIN_TOKEN")
fi

echo "[worker] Starting $TTB_WORKER_NAME with engines=$TTB_WORKER_ENGINES coordinator=$TTB_WORKER_COORDINATOR"
exec "$PYTHON_BIN" -m ttb_worker \
  --coordinator "$TTB_WORKER_COORDINATOR" \
  --name "$TTB_WORKER_NAME" \
  --concurrency "$TTB_WORKER_CONCURRENCY" \
  --engines "$TTB_WORKER_ENGINES" \
  --data-dir "$TTB_WORKER_DATA_DIR" \
  --secret-file "$TTB_WORKER_SECRET_FILE" \
  "${EXTRA_ARGS[@]}" \
  "$@"
