#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export TTB_API_DATABASE_URL="${TTB_API_DATABASE_URL:-sqlite:///./data/api.sqlite3}"
export TTB_API_DATA_DIR="${TTB_API_DATA_DIR:-$ROOT_DIR/data}"
export TTB_API_HOST="${TTB_API_HOST:-127.0.0.1}"
export TTB_API_PORT="${TTB_API_PORT:-8000}"
export TTB_API_STATIC_DIR="${TTB_API_STATIC_DIR:-$ROOT_DIR/apps/console/dist}"
export TTB_REQUIRE_WORKER_JOIN_TOKEN="${TTB_REQUIRE_WORKER_JOIN_TOKEN:-0}"

if [[ "$TTB_API_HOST" == "0.0.0.0" || "$TTB_API_HOST" == "::" ]]; then
  echo "WARNING: LAN mode enabled. Only run on a trusted network."
fi

BUILD_CONSOLE="${TTB_API_BUILD_CONSOLE:-auto}"
if [[ "$BUILD_CONSOLE" == "1" || ( "$BUILD_CONSOLE" == "auto" && ! -f "$TTB_API_STATIC_DIR/index.html" ) ]]; then
  echo "Building console into $TTB_API_STATIC_DIR..."
  npm --prefix apps/console run build
elif [[ -f "$TTB_API_STATIC_DIR/index.html" ]]; then
  echo "Serving existing console build from $TTB_API_STATIC_DIR."
else
  echo "Console build missing; running API with dev CORS only. Set TTB_API_BUILD_CONSOLE=1 to build it."
fi

DISPLAY_HOST="$TTB_API_HOST"
if [[ "$DISPLAY_HOST" == "0.0.0.0" || "$DISPLAY_HOST" == "::" ]]; then
  DISPLAY_HOST="127.0.0.1"
fi

echo "Backend API: http://$DISPLAY_HOST:$TTB_API_PORT/api/health"
if [[ -f "$TTB_API_STATIC_DIR/index.html" ]]; then
  echo "Console:     http://$DISPLAY_HOST:$TTB_API_PORT/"
else
  echo "Console dev: npm run console:dev"
fi

python -m uvicorn apps.api.app.main:app --host "$TTB_API_HOST" --port "$TTB_API_PORT" --reload
