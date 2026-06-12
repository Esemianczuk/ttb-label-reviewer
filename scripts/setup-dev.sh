#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${VENV_DIR:-.venv}"

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null || {
    echo "setup-dev: Node 20 is required. Install it with 'nvm install 20' or enable another Node >=20 runtime." >&2
    exit 1
  }
fi

command -v npm >/dev/null 2>&1 || {
  echo "setup-dev: npm is required. Install Node 20 or enable nvm first." >&2
  exit 1
}

if ! node <<'NODE'
const major = Number.parseInt(process.versions.node.split(".")[0], 10);
if (!Number.isFinite(major) || major < 20) {
  console.error(`Found Node ${process.versions.node}`);
  process.exit(1);
}
NODE
then
  echo "setup-dev: Node 20 or newer is required. Run 'source ~/.nvm/nvm.sh && nvm use 20' or install Node 20." >&2
  exit 1
fi

command -v "$PYTHON_BIN" >/dev/null 2>&1 || {
  echo "setup-dev: $PYTHON_BIN is required." >&2
  exit 1
}

if [[ -d "$VENV_DIR" && ! -x "$VENV_DIR/bin/python" ]]; then
  echo "setup-dev: removing incomplete virtual environment at $VENV_DIR"
  rm -rf "$VENV_DIR"
fi

if [[ ! -d "$VENV_DIR" ]]; then
  if ! "$PYTHON_BIN" -m venv "$VENV_DIR"; then
    echo "setup-dev: python venv support is unavailable; bootstrapping virtualenv with --user." >&2
    "$PYTHON_BIN" -m pip install --user virtualenv
    "$PYTHON_BIN" -m virtualenv "$VENV_DIR"
  fi
fi

# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt

npm install --prefix browser-demo
npm install --prefix apps/console
npm run playwright:install

cat <<'EOF'

Development setup complete.

Next commands:
  . .venv/bin/activate
  python -m pytest -q
  npm run console:dev
  ./scripts/dev-local-backend.sh
  ./scripts/dev-worker.sh
  ./scripts/check-all.sh
  RUN_E2E=1 ./scripts/check-all.sh
EOF
