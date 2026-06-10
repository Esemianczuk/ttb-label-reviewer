from __future__ import annotations

from dataclasses import dataclass
from time import monotonic


@dataclass
class HeartbeatCadence:
    interval_seconds: float = 5.0
    last_sent: float = 0.0

    def due(self) -> bool:
        return monotonic() - self.last_sent >= self.interval_seconds

    def mark_sent(self) -> None:
        self.last_sent = monotonic()
