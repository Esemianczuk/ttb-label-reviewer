from __future__ import annotations

from .evidence_task import process_evidence_job
from .ocr_task import process_ocr_job
from .validation_task import process_validation_job

__all__ = ["process_evidence_job", "process_ocr_job", "process_validation_job"]
