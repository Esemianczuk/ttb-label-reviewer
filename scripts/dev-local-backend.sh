#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export TTB_API_DATABASE_URL="${TTB_API_DATABASE_URL:-sqlite:///./data/api.sqlite3}"
export TTB_API_DATA_DIR="${TTB_API_DATA_DIR:-$ROOT_DIR/data}"
export TTB_API_HOST="${TTB_API_HOST:-127.0.0.1}"
export TTB_API_PORT="${TTB_API_PORT:-8000}"

if [[ "$TTB_API_HOST" == "0.0.0.0" || "$TTB_API_HOST" == "::" ]]; then
  echo "WARNING: LAN mode enabled. Only run on a trusted network."
fi

python -m uvicorn apps.api.app.main:app --host "$TTB_API_HOST" --port "$TTB_API_PORT" --reload
