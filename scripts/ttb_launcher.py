#!/usr/bin/env python3
"""Compatibility wrapper for the simplified one-command demo runner."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    script = root / "scripts" / "smart-demo.sh"
    if any(arg in {"--help", "-h"} for arg in sys.argv[1:]):
        print("Run the local backend + PaddleOCR worker demo:")
        print(f"  {script}")
        print()
        print("Configuration is by environment variable, for example TTB_API_PORT=8010.")
        return 0
    return subprocess.call([str(script)])


if __name__ == "__main__":
    raise SystemExit(main())
