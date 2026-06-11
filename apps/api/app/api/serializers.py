from __future__ import annotations

from .. import models
from ..core.statuses import canonical_application_status, canonical_review_status


def application_to_read(application: models.Application):
    return {
        "id": application.id,
        "sessionId": application.session_id,
        "source": application.source,
        "status": application.status,
        "canonicalStatus": canonical_application_status(application.status),
        "expectedFields": application.expected_fields,
        "metadata": application.metadata_json,
        "createdAt": application.created_at,
        "updatedAt": application.updated_at,
        "assetCount": len(application.assets or []),
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
        "capabilities": worker.capabilities,
        "calibration": worker.calibration,
        "activeJobs": worker.active_jobs,
        "maxConcurrency": worker.max_concurrency,
        "lastSeenAt": worker.last_seen_at,
        "createdAt": worker.created_at,
    }


def worker_event_to_read(event: models.WorkerEvent):
    return {
        "id": event.id,
        "workerId": event.worker_id,
        "eventType": event.event_type,
        "payload": event.payload_json,
        "createdAt": event.created_at,
    }
