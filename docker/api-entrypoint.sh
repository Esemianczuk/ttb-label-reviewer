#!/usr/bin/env bash
set -euo pipefail

cd /app

export TTB_API_DATABASE_URL="${TTB_API_DATABASE_URL:-sqlite:////data/api.sqlite3}"
export TTB_API_DATA_DIR="${TTB_API_DATA_DIR:-/data}"
export TTB_API_STATIC_DIR="${TTB_API_STATIC_DIR:-/app/apps/console/dist}"
export TTB_API_HOST="${TTB_API_HOST:-0.0.0.0}"
export TTB_API_PORT="${TTB_API_PORT:-8000}"
export TTB_REQUIRE_WORKER_JOIN_TOKEN="${TTB_REQUIRE_WORKER_JOIN_TOKEN:-1}"
export PYTHONUNBUFFERED="${PYTHONUNBUFFERED:-1}"

mkdir -p "$TTB_API_DATA_DIR"

if [[ "${TTB_SEED_DEMO:-1}" == "1" ]]; then
  echo "[api] Seeding bundled public COLA demo records..."
  python scripts/seed-backend-demo-fixtures.py
fi

echo "[api] Starting FastAPI on ${TTB_API_HOST}:${TTB_API_PORT}"
exec "$@"
