#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null || true
fi

export PYTHONPATH="$ROOT_DIR/apps/worker:$ROOT_DIR${PYTHONPATH:+:$PYTHONPATH}"

echo "[1/4] Python validation/API/worker regressions"
python -m pytest -q \
  ttb_validation/tests/test_field_entities.py \
  apps/worker/tests/test_worker_agent.py \
  apps/worker/tests/test_paddle_vertical_warning_recovery.py \
  apps/api/app/tests/test_phase3_api.py \
  apps/api/app/tests/test_phase15_security.py

echo "[2/4] Browser fallback/backend adapter regressions"
npm --prefix browser-demo test -- \
  src/tests/hybrid-mode.test.js \
  src/tests/export-report.test.js \
  src/tests/tesseract-assets.test.js

echo "[3/4] Console admin/RBAC regressions"
npm --prefix apps/console test -- \
  src/tests/unit/phase11AdminWorkflow.test.ts \
  src/tests/unit/permissionMatrix.test.ts \
  src/tests/unit/reviewerEntry.test.ts

echo "[4/4] Shared schema sanity"
python - <<'PY'
import json
from pathlib import Path

schema = json.loads(Path("packages/shared/schemas/review.schema.json").read_text(encoding="utf-8"))
assert schema["properties"]["mode"]["enum"] == ["browser", "backend"]
assert schema["properties"]["fields"]["items"]["$ref"] == "#/$defs/FieldReview"
print("review.schema.json mode enum is hardened to browser/backend")
PY

echo "Fast regression suite passed."
