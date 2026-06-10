#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null
fi

if [[ ! -d node_modules ]]; then
  npm install
fi

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5173}"
URL="http://${HOST}:${PORT}/"
LOG_FILE=".demo-server.log"
PID_FILE=".demo-server.pid"

if curl --silent --fail --max-time 1 "$URL" >/dev/null 2>&1; then
  echo "TTB Label Reviewer is already running at ${URL}"
else
  echo "Starting TTB Label Reviewer at ${URL}"
  npm run dev -- --host "$HOST" --port "$PORT" >"$LOG_FILE" 2>&1 &
  server_pid=$!
  echo "$server_pid" >"$PID_FILE"

  for _ in {1..40}; do
    if curl --silent --fail --max-time 1 "$URL" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
fi

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
fi

echo "Open ${URL}"
echo "Press Ctrl+C to stop this launcher. Server output is in ${LOG_FILE}."

if [[ -n "${server_pid:-}" ]]; then
  trap 'kill "$server_pid" 2>/dev/null || true' INT TERM EXIT
  wait "$server_pid"
else
  read -r -p "Press Enter to close this launcher." _
fi
