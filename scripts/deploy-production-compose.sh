#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${TTB_PRODUCTION_ENV_FILE:-$HOME/.config/ttb-label-reviewer/compose-production.env}"
ACCELERATOR="${TTB_DOCKER_ACCELERATOR:-}"

if [[ ! -f "$ENV_FILE" ]]; then
  cat >&2 <<EOF
Production environment file was not found:
  $ENV_FILE

Create it with:
  ./scripts/install-production-compose-service.sh
EOF
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for production Compose deployment." >&2
  exit 2
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required for production Compose deployment." >&2
  exit 2
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

ACCELERATOR="${ACCELERATOR:-${TTB_DOCKER_ACCELERATOR:-cuda}}"
COMPOSE_FILES=(-f docker-compose.yml)
if [[ "$ACCELERATOR" == "cuda" || "$ACCELERATOR" == "gpu" ]]; then
  COMPOSE_FILES+=(-f docker-compose.cuda.yml)
elif [[ "$ACCELERATOR" != "cpu" ]]; then
  echo "Unknown TTB_DOCKER_ACCELERATOR=$ACCELERATOR. Use cpu or cuda." >&2
  exit 2
fi

echo "Deploying TTB Label Reviewer production stack"
echo "Repository: $ROOT_DIR"
echo "Environment: $ENV_FILE"
echo "Bind: ${TTB_DOCKER_BIND_IP:-127.0.0.1}:${TTB_DOCKER_API_PORT:-8000}"
echo "Backend URL for built frontend: ${VITE_TTB_BACKEND_URL:-http://127.0.0.1:8000}"
echo "Compose accelerator: $ACCELERATOR"

docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" up -d --build --remove-orphans

echo
echo "Production stack is running."
docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" ps
