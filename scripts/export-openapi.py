from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from atexit import register
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

TEMP_DATA_DIR = tempfile.mkdtemp(prefix="ttb-openapi-export-")
register(lambda: shutil.rmtree(TEMP_DATA_DIR, ignore_errors=True))
os.environ.setdefault("TTB_API_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TTB_API_DATA_DIR", TEMP_DATA_DIR)

from apps.api.app.main import create_app


def main() -> None:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("openapi.generated.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    app = create_app(init_database=False)
    output.write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
