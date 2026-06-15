from __future__ import annotations

from copy import deepcopy

from .. import models
from ..core.application_numbers import metadata_with_existing_application_number
from ..core.statuses import canonical_application_status, canonical_review_run_status, canonical_review_status

PRODUCTION_ENGINE_KEYS = {"paddleocr"}
FIELD_EXTRACTOR_KEYS = {"fieldExtractor"}
STALE_ENGINE_KEYS = {"tesseract", "tesseract-js", "browser-tesseract", "onnx"}


def application_to_read(application: models.Application):
    status = canonical_application_status(application.status)
    metadata = metadata_with_existing_application_number(application)
    return {
        "id": application.id,
        "sessionId": application.session_id,
        "source": application.source,
        "status": status,
        "canonicalStatus": status,
        "ownerUserId": application.owner_user_id,
        "organizationId": application.organization_id,
        "expectedFields": application.expected_fields,
        "metadata": metadata,
        "createdAt": application.created_at,
        "updatedAt": application.updated_at,
        "assetCount": len(application.assets or []),
        "versionCount": len(application.versions or []),
        "currentVersionNumber": application.versions[-1].version_number if application.versions else None,
    }


def asset_to_read(asset: models.Asset):
    return {
        "id": asset.id,
        "applicationId": asset.application_id,
        "sha256": asset.sha256,
        "originalFilename": asset.original_filename,
        "mimeType": asset.mime_type,
        "sizeBytes": asset.size_bytes,
        "role": asset.role,
        "width": asset.width,
        "height": asset.height,
        "createdAt": asset.created_at,
    }


def review_to_read(review: models.Review):
    return {
        "id": review.id,
        "applicationId": review.application_id,
        "mode": review.mode,
        "status": review.status,
        "runStatus": canonical_review_run_status(review.status),
        "canonicalStatus": canonical_review_status(review.status),
        "result": review.result_json,
        "createdAt": review.created_at,
        "completedAt": review.completed_at,
    }


def job_to_read(job: models.Job):
    return {
        "id": job.id,
        "applicationId": job.application_id,
        "reviewId": job.review_id,
        "sessionId": job.session_id,
        "jobType": job.job_type,
        "status": job.status,
        "priority": job.priority,
        "payload": job.payload_json,
        "result": job.result_json,
        "requiredCapabilities": job.required_capabilities,
        "assignedWorkerId": job.assigned_worker_id,
        "leaseExpiresAt": job.lease_expires_at,
        "attempts": job.attempts,
        "error": job.error,
        "createdAt": job.created_at,
        "updatedAt": job.updated_at,
        "startedAt": job.started_at,
        "completedAt": job.completed_at,
    }


def worker_to_read(worker: models.Worker):
    return {
        "id": worker.id,
        "hostname": worker.hostname,
        "platform": worker.platform,
        "arch": worker.arch,
        "version": worker.version,
        "status": worker.status,
        "capabilities": sanitize_worker_capabilities(worker.capabilities),
        "calibration": sanitize_worker_calibration(worker.calibration),
        "activeJobs": worker.active_jobs,
        "maxConcurrency": worker.max_concurrency,
        "lastSeenAt": worker.last_seen_at,
        "createdAt": worker.created_at,
    }


def sanitize_worker_capabilities(capabilities: dict | None) -> dict:
    """Hide retired OCR engines from stale worker records without mutating DB rows."""
    if not isinstance(capabilities, dict):
        return {}
    cleaned = deepcopy(capabilities)
    for key in ("onnxRuntime", "tesseractRuntime"):
        cleaned.pop(key, None)

    engines = cleaned.get("engines")
    if isinstance(engines, dict):
        cleaned["engines"] = {
            key: value
            for key, value in engines.items()
            if key in PRODUCTION_ENGINE_KEYS or key in FIELD_EXTRACTOR_KEYS
        }

    ocr = cleaned.get("ocr")
    if isinstance(ocr, dict):
        cleaned["ocr"] = {
            key: value
            for key, value in ocr.items()
            if key in PRODUCTION_ENGINE_KEYS or key in FIELD_EXTRACTOR_KEYS
        }

    profile = cleaned.get("engineProfile")
    if isinstance(profile, dict):
        for key in STALE_ENGINE_KEYS:
            profile.pop(key, None)
        if profile.get("preferredEngine") in STALE_ENGINE_KEYS:
            profile["preferredEngine"] = "paddleocr"
        if profile.get("tier") in STALE_ENGINE_KEYS:
            profile["tier"] = "paddleocr_unavailable"

    for list_key in ("warmEngines", "supportedEngines"):
        values = cleaned.get(list_key)
        if isinstance(values, list):
            cleaned[list_key] = [value for value in values if value in PRODUCTION_ENGINE_KEYS]

    return cleaned


def sanitize_worker_calibration(calibration: dict | None) -> dict | None:
    """Normalize stale calibration metadata from earlier demo engine mixes."""
    if not isinstance(calibration, dict):
        return calibration
    cleaned = deepcopy(calibration)

    configured = cleaned.get("configuredEngines")
    if isinstance(configured, list):
        cleaned["configuredEngines"] = [engine for engine in configured if engine in PRODUCTION_ENGINE_KEYS]

    engines = cleaned.get("engines")
    if isinstance(engines, dict):
        cleaned["engines"] = {
            key: value
            for key, value in engines.items()
            if key in PRODUCTION_ENGINE_KEYS or key in FIELD_EXTRACTOR_KEYS
        }

    profile = cleaned.get("engineProfile")
    if isinstance(profile, dict):
        for key in STALE_ENGINE_KEYS:
            profile.pop(key, None)
        if profile.get("preferredEngine") in STALE_ENGINE_KEYS:
            profile["preferredEngine"] = "paddleocr"
        if profile.get("tier") in STALE_ENGINE_KEYS:
            profile["tier"] = "paddleocr_unavailable"

    return cleaned


def worker_event_to_read(event: models.WorkerEvent):
    return {
        "id": event.id,
        "workerId": event.worker_id,
        "eventType": event.event_type,
        "payload": event.payload_json,
        "createdAt": event.created_at,
    }


def organization_to_read(organization: models.Organization):
    return {
        "id": organization.id,
        "name": organization.name,
        "type": organization.type,
        "createdAt": organization.created_at,
    }


def user_to_read(user: models.User):
    return {
        "id": user.id,
        "email": user.email,
        "displayName": user.display_name,
        "role": user.role,
        "status": user.status,
        "organizationId": user.organization_id,
        "createdAt": user.created_at,
        "updatedAt": user.updated_at,
    }


def application_version_to_read(version: models.ApplicationVersion):
    return {
        "id": version.id,
        "applicationId": version.application_id,
        "versionNumber": version.version_number,
        "expectedFields": version.expected_fields,
        "metadata": version.metadata_json,
        "createdByUserId": version.created_by_user_id,
        "createdAt": version.created_at,
        "submittedAt": version.submitted_at,
    }


def review_decision_to_read(decision: models.ReviewDecision):
    return {
        "id": decision.id,
        "reviewId": decision.review_id,
        "fieldKey": decision.field_key,
        "autoStatus": decision.auto_status,
        "reviewerStatus": decision.reviewer_status,
        "effectiveStatus": decision.effective_status,
        "reviewerNote": decision.reviewer_note,
        "reviewerUserId": decision.reviewer_user_id,
        "createdAt": decision.created_at,
        "updatedAt": decision.updated_at,
    }


def correction_request_to_read(correction_request: models.CorrectionRequest):
    return {
        "id": correction_request.id,
        "applicationId": correction_request.application_id,
        "reviewId": correction_request.review_id,
        "requestedByUserId": correction_request.requested_by_user_id,
        "status": correction_request.status,
        "message": correction_request.message,
        "fieldKeys": correction_request.field_keys,
        "createdAt": correction_request.created_at,
        "resolvedAt": correction_request.resolved_at,
    }


def audit_event_to_read(event: models.AuditEvent):
    return {
        "id": event.id,
        "actorUserId": event.actor_user_id,
        "actorRole": event.actor_role,
        "eventType": event.event_type,
        "entityType": event.entity_type,
        "entityId": event.entity_id,
        "summary": event.summary,
        "before": event.before_json,
        "after": event.after_json,
        "metadata": event.metadata_json,
        "createdAt": event.created_at,
    }


def setting_to_read(setting: models.Setting):
    return {
        "id": setting.key,
        "key": setting.key,
        "value": setting.value_json,
        "updatedAt": setting.updated_at,
    }
