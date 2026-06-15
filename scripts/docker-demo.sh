#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ACCELERATOR="${TTB_DOCKER_ACCELERATOR:-auto}"
HOST_OS="$(uname -s)"

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    cat >&2 <<'EOF'
Docker is required for the one-command evaluator path.

Install Docker Desktop, Docker Engine, or Colima, start the Docker service, then rerun:
  ./scripts/docker-demo.sh
EOF
    exit 2
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose v2 is required. Update Docker Desktop or install the compose plugin." >&2
    exit 2
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed, but the daemon is not reachable. Start Docker and rerun this script." >&2
    exit 2
  fi
}

check_port() {
  local port="${TTB_DOCKER_API_PORT:-8000}"
  if [[ "${TTB_DOCKER_SKIP_PORT_CHECK:-0}" == "1" ]]; then
    return 0
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    return 0
  fi
  if python3 - "$port" <<'PY'
import socket
import sys

port = int(sys.argv[1])
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    sock.bind(("127.0.0.1", port))
except OSError:
    raise SystemExit(1)
finally:
    sock.close()
PY
  then
    return 0
  fi
  if [[ -n "$(docker compose ps -q api 2>/dev/null || true)" ]]; then
    return 0
  fi
  cat >&2 <<EOF
Port 127.0.0.1:$port is already in use.

Stop the other process or run with a different port, for example:
  TTB_DOCKER_API_PORT=8010 ./scripts/docker-demo.sh
EOF
  exit 2
}

if [[ "$HOST_OS" == "Darwin" ]]; then
  if [[ "$ACCELERATOR" == "cpu" || "$ACCELERATOR" == "container" ]]; then
    require_docker
    check_port
    echo "Starting Docker-only Mac diagnostic mode. This does not expose Apple Metal to the worker container."
    exec docker compose -f docker-compose.yml -f docker-compose.mac.yml --profile container-worker up --build
  fi
  exec "$ROOT_DIR/scripts/docker-mac-metal.sh"
fi

require_docker
check_port

compose_files=(-f docker-compose.yml)
mode_label="Linux CPU"

docker_gpu_probe() {
  if [[ "${TTB_DOCKER_SKIP_GPU_PROBE:-0}" == "1" ]]; then
    return 1
  fi
  if ! command -v nvidia-smi >/dev/null 2>&1; then
    return 1
  fi
  echo "NVIDIA GPU detected. Checking Docker GPU passthrough..." >&2
  docker run --rm --gpus all --entrypoint nvidia-smi nvidia/cuda:12.6.3-cudnn-runtime-ubuntu22.04 >/dev/null 2>&1
}

if [[ "$ACCELERATOR" == "cuda" || "$ACCELERATOR" == "gpu" ]]; then
  compose_files+=(-f docker-compose.cuda.yml)
  mode_label="Linux CUDA"
elif [[ "$ACCELERATOR" == "auto" ]]; then
  if docker_gpu_probe; then
    compose_files+=(-f docker-compose.cuda.yml)
    mode_label="Linux CUDA"
  else
    echo "Docker GPU passthrough was not available; starting the CPU PaddleOCR worker." >&2
  fi
elif [[ "$ACCELERATOR" != "cpu" ]]; then
  echo "Unknown TTB_DOCKER_ACCELERATOR=$ACCELERATOR. Use auto, cpu, cuda, or gpu." >&2
  exit 2
fi

cat <<EOF
Starting TTB Label Reviewer with Docker Compose ($mode_label).

Console: http://127.0.0.1:${TTB_DOCKER_API_PORT:-8000}/

Press Ctrl+C to stop.
EOF

exec docker compose "${compose_files[@]}" up --build
