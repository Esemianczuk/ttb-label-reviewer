from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import models
from ..config import get_settings
from .demo_identity import DEMO_ORGANIZATION, DEMO_USERS
from .fingerprints import sha256_bytes
from .security import validate_image_upload


ROOT = Path(__file__).resolve().parents[4]
FIXTURE_ROOT = ROOT / "fixtures" / "public-cola-registry" / "records"
LEGACY_SHARED_SESSION_ID = "console-demo-session"
CORRECTION_RECORD_ID = "19350001000429"


def ensure_demo_session(session: Session, session_id: str, *, reset_review_state: bool = False) -> None:
    """Materialize a private demo fixture set for this browser session.

    The console uses stable public IDs like ``app-ttb-19337001000251`` so that
    local browser mode and backend mode can share URLs. Backend rows are scoped
    by session using internal IDs, and route resolvers translate the public ID
    into the current session's private copy before mutating review state.
    """

    if not should_seed_demo_session(session_id):
        return

    existing_public_fixture = session.scalar(
        select(models.Application.id)
        .where(
            models.Application.session_id == session_id,
            models.Application.source == "public_cola_registry",
        )
        .limit(1)
    )
    if existing_public_fixture and not reset_review_state:
        return

    records = sorted(load_records(), key=lambda record: record["record_id"])
    if not records:
        return

    application_ids = [application_id_for_session(session_id, record["record_id"]) for record in records]
    if reset_review_state:
        reset_seeded_review_state(session, application_ids)

    asset_root = get_settings().asset_root
    asset_root.mkdir(parents=True, exist_ok=True)
    for index, record in enumerate(records):
        seed_record(session, asset_root, session_id, record, index)
    session.commit()


def should_seed_demo_session(session_id: str) -> bool:
    if os.environ.get("TTB_ENABLE_SESSION_DEMO_SEED", "1") == "0":
        return False
    if os.environ.get("TTB_SEED_ALL_SESSIONS") == "1":
        return True
    return session_id in {LEGACY_SHARED_SESSION_ID, "local-dev-session"} or session_id.startswith("console-")


def public_application_id(record_id: str) -> str:
    return f"app-ttb-{record_id}"


def application_id_for_session(session_id: str, record_id: str) -> str:
    if session_id == LEGACY_SHARED_SESSION_ID:
        return public_application_id(record_id)
    return f"app-{session_hash(session_id)}-{record_id}"


def asset_id_for_session(session_id: str, record_id: str, index: int) -> str:
    if session_id == LEGACY_SHARED_SESSION_ID:
        return f"ttb-{record_id}-image-{index + 1}"
    return f"asset-{session_hash(session_id)}-{record_id}-{index + 1}"


def session_hash(session_id: str) -> str:
    return hashlib.sha1(session_id.encode("utf-8")).hexdigest()[:8]


def record_id_from_application_id(application_id: str) -> str | None:
    public_match = re.fullmatch(r"app-ttb-(\d+)", application_id)
    if public_match:
        return public_match.group(1)
    private_match = re.fullmatch(r"app-[0-9a-f]{8}-(\d+)", application_id)
    if private_match:
        return private_match.group(1)
    return None


def resolve_application_for_session(session: Session, application_id: str, session_id: str) -> models.Application | None:
    ensure_demo_session(session, session_id)
    direct = session.get(models.Application, application_id)
    if direct and direct.session_id == session_id:
        return direct

    record_id = record_id_from_application_id(application_id)
    if not record_id:
        return None
    session_application_id = application_id_for_session(session_id, record_id)
    if session_application_id == application_id:
        return direct if direct and direct.session_id == session_id else None
    return session.get(models.Application, session_application_id)


def load_records() -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for expected_path in FIXTURE_ROOT.glob("*/expected.json"):
        expected = json.loads(expected_path.read_text(encoding="utf-8"))
        if expected.get("demo_ready") is False:
            continue
        record_dir = expected_path.parent
        metadata_path = record_dir / "metadata.json"
        if not metadata_path.exists():
            continue
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if not label_assets(record_dir, metadata):
            continue
        records.append({"record_id": record_dir.name, "record_dir": record_dir, "expected": expected, "metadata": metadata})
    return records


def seed_record(session: Session, asset_root: Path, session_id: str, record: dict[str, Any], index: int) -> None:
    record_id = record["record_id"]
    expected_fields = expected_fields_for(record)
    metadata = metadata_for(record, index, session_id)
    application_id = application_id_for_session(session_id, record_id)
    application = session.get(models.Application, application_id)
    if application is None:
        application = models.Application(id=application_id)
        session.add(application)
    application.session_id = session_id
    application.owner_user_id = DEMO_USERS["applicant"]["id"]
    application.organization_id = DEMO_ORGANIZATION["id"]
    application.source = "public_cola_registry"
    application.status = "NEEDS_CORRECTION" if record_id == CORRECTION_RECORD_ID else "SUBMITTED"
    application.expected_fields = expected_fields
    application.metadata_json = metadata

    version = session.scalar(
        select(models.ApplicationVersion).where(
            models.ApplicationVersion.application_id == application_id,
            models.ApplicationVersion.version_number == 1,
        )
    )
    if version is None:
        version = models.ApplicationVersion(application_id=application_id, version_number=1)
        session.add(version)
    version.expected_fields = expected_fields
    version.metadata_json = metadata
    version.created_by_user_id = DEMO_USERS["applicant"]["id"]

    for asset_index, asset_info in enumerate(label_assets(record["record_dir"], record["metadata"])):
        seed_asset(session, asset_root, session_id, application_id, record_id, asset_index, asset_info)


def expected_fields_for(record: dict[str, Any]) -> dict[str, Any]:
    expected = record["expected"].get("expected_fields") or {}
    metadata = record["metadata"]
    application = metadata.get("application") or {}
    raw = raw_field_map(metadata)
    responsible = expected.get("responsibleParty") or {}
    is_imported = expected.get("isImported") is True
    class_type = first_value(expected.get("classType"), application.get("class_type"), raw.get("class/type code"))
    return {
        "productType": normalize_product_type(first_value(expected.get("productType"), application.get("product_type"), raw.get("product type"), class_type)),
        "brandName": first_value(expected.get("brandName"), application.get("brand_name"), raw.get("brand name")),
        "fancifulName": first_value(expected.get("fancifulName"), application.get("fanciful_name"), raw.get("fanciful name")) or None,
        "classType": class_type,
        "alcoholContent": first_value(expected.get("alcoholContent"), application.get("alcohol_content"), raw.get("alcohol content")),
        "netContents": first_value(expected.get("netContents"), application.get("net_contents")),
        "governmentWarningRequired": expected.get("governmentWarningRequired", True) is not False,
        "producerName": first_value(responsible.get("name"), application.get("applicant_name"), metadata.get("applicant_name"), raw.get("applicant name")) or None,
        "countryOfOrigin": first_value(expected.get("countryOfOrigin"), application.get("origin"), raw.get("country of origin")) if is_imported else None,
        "applicationId": metadata.get("ttb_id") or record["record_id"],
        "labelId": metadata.get("serial_number") or raw.get("serial #") or record["record_id"],
    }


def metadata_for(record: dict[str, Any], index: int, session_id: str) -> dict[str, Any]:
    metadata = record["metadata"]
    expected = record["expected"]
    record_id = record["record_id"]
    return {
        "applicationNumber": f"TTB-2026-{index + 1:04d}",
        "applicationId": metadata.get("ttb_id") or record_id,
        "publicApplicationId": public_application_id(record_id),
        "ttbId": metadata.get("ttb_id") or record_id,
        "fixtureId": expected.get("fixture_id") or f"ttb_{record_id}",
        "packetPath": f"fixtures/public-cola-registry/records/{record_id}",
        "sourceUrl": (metadata.get("source") or {}).get("detail_url"),
        "demoSessionId": session_id,
        "notes": "Seeded from bundled public COLA registry fixtures for this isolated evaluator session.",
    }


def label_assets(record_dir: Path, metadata: dict[str, Any]) -> list[dict[str, Any]]:
    assets = []
    for asset in metadata.get("assets") or []:
        if asset.get("kind") != "label_image" or not asset.get("local_path"):
            continue
        path = record_dir / asset["local_path"]
        if path.exists():
            assets.append({**asset, "path": path})
    return assets


def seed_asset(
    session: Session,
    asset_root: Path,
    session_id: str,
    application_id: str,
    record_id: str,
    index: int,
    asset_info: dict[str, Any],
) -> None:
    path = Path(asset_info["path"])
    data = path.read_bytes()
    image = validate_image_upload(data, None, "")
    sha256 = sha256_bytes(data)
    storage_path = asset_root / sha256[:2] / f"{sha256}{image.extension}"
    storage_path.parent.mkdir(parents=True, exist_ok=True)
    if not storage_path.exists():
        storage_path.write_bytes(data)

    asset_id = asset_id_for_session(session_id, record_id, index)
    asset = session.get(models.Asset, asset_id)
    if asset is None:
        asset = models.Asset(id=asset_id, application_id=application_id, sha256=sha256)
        session.add(asset)
    asset.application_id = application_id
    asset.sha256 = sha256
    asset.original_filename = path.name
    asset.mime_type = image.mime_type
    asset.size_bytes = len(data)
    asset.storage_path = str(storage_path)
    asset.role = role_from_image_name(path.name, index)
    asset.width = image.width
    asset.height = image.height


def reset_seeded_review_state(session: Session, application_ids: list[str]) -> None:
    review_ids = [
        row[0]
        for row in session.execute(select(models.Review.id).where(models.Review.application_id.in_(application_ids))).all()
    ]
    if review_ids:
        session.execute(delete(models.ReviewDecision).where(models.ReviewDecision.review_id.in_(review_ids)))
        session.execute(delete(models.CorrectionRequest).where(models.CorrectionRequest.review_id.in_(review_ids)))
    session.execute(delete(models.Job).where(models.Job.application_id.in_(application_ids)))
    session.execute(delete(models.Review).where(models.Review.application_id.in_(application_ids)))


def raw_field_map(metadata: dict[str, Any]) -> dict[str, str]:
    return {str(field.get("label") or "").strip().lower(): str(field.get("value") or "").strip() for field in metadata.get("raw_fields") or []}


def first_value(*values: Any) -> str:
    return next((str(value).strip() for value in values if str(value or "").strip()), "")


def normalize_product_type(value: str) -> str:
    lower = value.lower()
    if "wine" in lower:
        return "wine"
    if any(token in lower for token in ("malt", "beer", "ale", "stout")):
        return "malt_beverage"
    if any(token in lower for token in ("spirit", "vodka", "tequila", "rum", "whisk", "gin")):
        return "distilled_spirits"
    return value or "unknown"


def role_from_image_name(name: str, index: int) -> str:
    lower = name.lower()
    if "front" in lower:
        return "front"
    if "back" in lower:
        return "back"
    if "neck" in lower:
        return "neck"
    if "carton" in lower:
        return "carton"
    return "front" if index == 0 else "back" if index == 1 else "other"
