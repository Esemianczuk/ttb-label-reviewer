#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ok() {
  printf '[ok] %s\n' "$*"
}

warn() {
  printf '[warn] %s\n' "$*"
}

fail() {
  printf '[missing] %s\n' "$*"
}

version_or_missing() {
  local command_name="$1"
  local version_arg="${2:---version}"
  if command -v "$command_name" >/dev/null 2>&1; then
    local version
    if version="$("$command_name" "$version_arg" 2>&1 | head -n 1)"; then
      ok "$command_name: $version"
      return 0
    fi
    warn "$command_name is on PATH but did not run cleanly: $version"
    return 1
  fi
  fail "$command_name is not installed or not on PATH"
  return 1
}

echo "TTB Label Reviewer setup check"
echo "Repository: $ROOT_DIR"
echo

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null 2>&1 || warn "nvm is installed but Node 20 is not active; run 'nvm install 20'"
fi

PYTHON_BIN="${PYTHON_BIN:-python3}"
if command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  "$PYTHON_BIN" - <<'PY'
import sys
status = "ok" if sys.version_info >= (3, 10) else "missing"
print(f"[{status}] python: {sys.version.split()[0]}")
PY
else
  fail "$PYTHON_BIN is not installed"
fi

if [[ -x ".venv/bin/python" ]]; then
  ok "virtualenv: .venv"
  .venv/bin/python - <<'PY'
import importlib.util

modules = ["fastapi", "uvicorn", "paddleocr", "paddle", "PIL", "ttb_worker", "ttb_validation"]
for module in modules:
    print(f"[{'ok' if importlib.util.find_spec(module) else 'missing'}] python import: {module}")
PY
else
  warn "virtualenv: .venv not found; ./scripts/smart-demo.sh will create it"
fi

echo
version_or_missing node || true
version_or_missing npm || true
if command -v node >/dev/null 2>&1; then
  node <<'NODE' || warn "Node 20 or newer is required for frontend builds"
const major = Number.parseInt(process.versions.node.split(".")[0], 10);
if (!Number.isFinite(major) || major < 20) process.exit(1);
NODE
fi

echo
if command -v docker >/dev/null 2>&1; then
  ok "docker: $(docker --version 2>&1 | head -n 1)"
  if docker compose version >/dev/null 2>&1; then
    ok "docker compose: $(docker compose version 2>&1 | head -n 1)"
  else
    warn "Docker Compose v2 is not available"
  fi
  if docker info >/dev/null 2>&1; then
    ok "docker daemon: reachable"
  else
    warn "docker daemon: installed but not reachable"
  fi
else
  warn "docker: not installed; use ./scripts/smart-demo.sh for native setup"
fi

if command -v nvidia-smi >/dev/null 2>&1; then
  ok "nvidia-smi: $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -n 1)"
else
  warn "nvidia-smi: not found; Linux CUDA Docker auto mode will use CPU unless Docker GPU passthrough is available"
fi

echo
if [[ -f "apps/console/dist/index.html" ]]; then
  ok "console build: apps/console/dist"
else
  warn "console build missing; ./scripts/smart-demo.sh or ./scripts/dev-local-backend.sh will build it"
fi

if [[ -d "fixtures/public-cola-registry/records" ]]; then
  ok "public COLA fixtures: fixtures/public-cola-registry/records"
else
  warn "public COLA fixtures not found"
fi

echo
echo "Recommended next command:"
echo "  ./scripts/smart-demo.sh"
echo
echo "Docker path:"
echo "  ./scripts/docker-demo.sh"
