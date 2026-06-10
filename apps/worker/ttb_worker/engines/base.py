from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class EngineEstimate:
    engine_id: str
    estimated_ms: int
    confidence: float
    reason_codes: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class EngineHealth:
    engine_id: str
    available: bool
    status: str
    detail: str | None = None
    version: str | None = None


@dataclass(frozen=True)
class OcrResult:
    engine_id: str
    text: str
    confidence: float
    lines: list[dict[str, Any]] = field(default_factory=list)
    words: list[dict[str, Any]] = field(default_factory=list)
    elapsed_ms: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


class OcrEngine(ABC):
    id: str
    display_name: str
    supports_gpu: bool = False
    supports_cpu: bool = True

    @abstractmethod
    def warmup(self) -> None:
        """Prepare local resources without requiring a network service."""

    @abstractmethod
    def estimate(self, task: dict[str, Any], capabilities: dict[str, Any]) -> EngineEstimate:
        """Return an estimate used by the worker to choose an engine."""

    @abstractmethod
    def recognize(self, image_bytes: bytes, options: dict[str, Any] | None = None) -> OcrResult:
        """Run OCR on one image."""

    @abstractmethod
    def healthcheck(self) -> EngineHealth:
        """Report availability without raising on missing optional dependencies."""
