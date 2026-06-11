#!/usr/bin/env python3
"""Verify the Phase 3 Python development environment.

This check is deliberately import-based. It catches missing editable installs
and dependency gaps before pytest fails later with a less direct error.
"""

from __future__ import annotations

import importlib
import sys


REQUIRED_IMPORTS = [
    "pytest",
    "httpx",
    "alembic",
    "sqlalchemy",
    "fastapi",
    "uvicorn",
    "pydantic",
    "tools.ttb_collector",
    "app.main",
    "ttb_worker.main",
]


def main() -> int:
    if sys.version_info < (3, 10):
        print("Python 3.10+ is required; Python 3.11 or 3.12 is recommended.", file=sys.stderr)
        return 1

    failures: list[str] = []
    for module_name in REQUIRED_IMPORTS:
        try:
            importlib.import_module(module_name)
        except Exception as exc:
            failures.append(f"{module_name}: {exc}")

    if failures:
        print("Python environment is incomplete. Run ./scripts/setup-dev.sh.", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print(
        "Python environment OK: "
        f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}; "
        f"{len(REQUIRED_IMPORTS)} imports verified."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
