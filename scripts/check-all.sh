#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

fail() {
  echo "check-all: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing '$1'. Run ./scripts/setup-dev.sh first."
}

use_node_20_if_available() {
  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    source "$HOME/.nvm/nvm.sh"
    nvm use 20 >/dev/null
  fi
}

ensure_node_deps() {
  local app_dir="$1"
  [[ -d "$app_dir/node_modules" ]] || fail "Missing $app_dir/node_modules. Run ./scripts/setup-dev.sh or npm install --prefix $app_dir."
}

ensure_python_env() {
  if [[ -d ".venv" ]]; then
    # shellcheck source=/dev/null
    source ".venv/bin/activate"
    return
  fi

  if [[ -n "${VIRTUAL_ENV:-}" ]]; then
    return
  fi

  fail "Missing .venv. Run ./scripts/setup-dev.sh so tests use local editable installs instead of global Python packages."
}

ensure_playwright_chromium() {
  node <<'NODE' || fail "Playwright Chromium is missing. Run npm run playwright:install."
const fs = require("node:fs");
const { chromium } = require("./browser-demo/node_modules/playwright");
const executable = chromium.executablePath();
if (!fs.existsSync(executable)) {
  console.error(`Missing Playwright browser executable: ${executable}`);
  process.exit(1);
}
NODE
}

use_node_20_if_available
require_command npm
require_command node

ensure_node_deps browser-demo
ensure_node_deps apps/console

ensure_python_env
require_command python
python scripts/check-python-env.py

if [[ "${RUN_E2E:-0}" == "1" ]]; then
  ensure_playwright_chromium
fi

echo "== Browser unit tests =="
npm run browser:test

echo "== Console unit tests =="
npm run console:test

echo "== Python tests =="
python -m pytest -q

echo "== Browser build =="
npm run browser:build

echo "== Console build =="
npm run console:build

if [[ "${RUN_E2E:-0}" == "1" ]]; then
  echo "== Browser Playwright =="
  npm run browser:e2e

  echo "== Console Playwright =="
  npm run console:e2e
else
  echo "== E2E skipped =="
  echo "Set RUN_E2E=1 to run Playwright. If Chromium is missing, run npm run playwright:install."
fi
