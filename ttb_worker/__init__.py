from __future__ import annotations

from pathlib import Path

_REAL_PACKAGE = Path(__file__).resolve().parents[1] / "apps" / "worker" / "ttb_worker"
__path__ = [str(_REAL_PACKAGE)]

from .agent import WorkerAgent, WorkerConfig  # noqa: E402

__all__ = ["WorkerAgent", "WorkerConfig"]
