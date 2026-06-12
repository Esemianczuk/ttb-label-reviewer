from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models

APPLICATION_NUMBER_PREFIX = "TTB"
APPLICATION_NUMBER_YEAR = "2026"


def create_application_number(index: int) -> str:
    return f"{APPLICATION_NUMBER_PREFIX}-{APPLICATION_NUMBER_YEAR}-{max(1, index):04d}"


def application_number_for(application: models.Application) -> str:
    metadata = application.metadata_json or {}
    number = metadata.get("applicationNumber")
    if isinstance(number, str) and number.strip():
        return number
    return fallback_application_number(application.id)


def metadata_with_application_number(session: Session, metadata: dict) -> dict:
    next_metadata = dict(metadata or {})
    if isinstance(next_metadata.get("applicationNumber"), str) and next_metadata["applicationNumber"].strip():
        return next_metadata
    used: set[str] = set()
    for (row_metadata,) in session.execute(select(models.Application.metadata_json)):
        number = (row_metadata or {}).get("applicationNumber")
        if isinstance(number, str) and number.strip():
            used.add(number)
    ordinal = next_ordinal(used)
    number = create_application_number(ordinal)
    while number in used:
        ordinal += 1
        number = create_application_number(ordinal)
    next_metadata["applicationNumber"] = number
    return next_metadata


def metadata_with_existing_application_number(application: models.Application, metadata: dict | None = None) -> dict:
    next_metadata = dict(metadata or application.metadata_json or {})
    next_metadata.setdefault("applicationNumber", application_number_for(application))
    return next_metadata


def next_ordinal(numbers: set[str]) -> int:
    ordinals = [parse_ordinal(number) for number in numbers]
    ordinals = [ordinal for ordinal in ordinals if ordinal > 0]
    return max(ordinals, default=0) + 1


def parse_ordinal(application_number: str) -> int:
    tail = application_number.rsplit("-", 1)[-1]
    return int(tail) if tail.isdigit() else 0


def fallback_application_number(application_id: str) -> str:
    hash_value = 0
    for char in application_id:
        hash_value = ((hash_value * 31) + ord(char)) & 0xFFFFFFFF
    return f"{APPLICATION_NUMBER_PREFIX}-{APPLICATION_NUMBER_YEAR}-{hash_value % 1_000_000:06d}"
