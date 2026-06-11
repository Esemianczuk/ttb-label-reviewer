from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from .. import models
from ..api.serializers import (
    application_to_read,
    audit_event_to_read,
    job_to_read,
    review_to_read,
    worker_event_to_read,
    worker_to_read,
)

router = APIRouter(tags=["websockets"])

POLL_SECONDS = 1.0
LIVE_RESOURCES = ("applications", "reviews", "jobs", "workers", "auditEvents")
CHANNELS = {resource: f"resources/{resource}" for resource in LIVE_RESOURCES}


@router.websocket("/api/ws/sessions/{session_id}")
async def session_progress(websocket: WebSocket, session_id: str):
    await websocket.accept()
    await websocket.send_json({"type": "connected", "scope": "session", "sessionId": session_id})
    last_snapshot: dict[str, Any] | None = session_snapshot(websocket, session_id)
    last_signature = last_snapshot["signature"]
    await websocket.send_json(jsonable_encoder(last_snapshot))
    try:
        while True:
            try:
                message = await asyncio.wait_for(websocket.receive_text(), timeout=POLL_SECONDS)
                await websocket.send_json({"type": "echo", "scope": "session", "sessionId": session_id, "message": message})
            except asyncio.TimeoutError:
                snapshot = session_snapshot(websocket, session_id)
                signature = snapshot["signature"]
                if signature != last_signature:
                    events = live_events(last_snapshot, snapshot)
                    last_snapshot = snapshot
                    last_signature = signature
                    await websocket.send_json(jsonable_encoder(snapshot))
                    if events:
                        await websocket.send_json(
                            jsonable_encoder(
                                {
                                    "type": "live_events",
                                    "scope": "session",
                                    "sessionId": session_id,
                                    "events": events,
                                    "signature": signature,
                                }
                            )
                        )
    except WebSocketDisconnect:
        return


@router.websocket("/api/ws/workers/{worker_id}")
async def worker_progress(websocket: WebSocket, worker_id: str):
    await websocket.accept()
    await websocket.send_json({"type": "connected", "scope": "worker", "workerId": worker_id})
    last_snapshot: dict[str, Any] | None = worker_snapshot(websocket, worker_id)
    last_signature = last_snapshot["signature"]
    await websocket.send_json(jsonable_encoder(last_snapshot))
    try:
        while True:
            try:
                message = await asyncio.wait_for(websocket.receive_text(), timeout=POLL_SECONDS)
                await websocket.send_json({"type": "echo", "scope": "worker", "workerId": worker_id, "message": message})
            except asyncio.TimeoutError:
                snapshot = worker_snapshot(websocket, worker_id)
                signature = snapshot["signature"]
                if signature != last_signature:
                    events = live_events(last_snapshot, snapshot)
                    last_snapshot = snapshot
                    last_signature = signature
                    await websocket.send_json(jsonable_encoder(snapshot))
                    if events:
                        await websocket.send_json(
                            jsonable_encoder(
                                {
                                    "type": "live_events",
                                    "scope": "worker",
                                    "workerId": worker_id,
                                    "events": events,
                                    "signature": signature,
                                }
                            )
                        )
    except WebSocketDisconnect:
        return


def session_snapshot(websocket: WebSocket, session_id: str) -> dict[str, Any]:
    session_factory = websocket.app.state.session_factory
    with session_factory() as session:
        applications = session.scalars(
            select(models.Application)
            .options(selectinload(models.Application.assets), selectinload(models.Application.versions))
            .where(models.Application.session_id == session_id)
            .order_by(models.Application.updated_at.desc())
            .limit(50)
        ).all()
        reviews = session.scalars(
            select(models.Review)
            .join(models.Application)
            .where(models.Application.session_id == session_id)
            .order_by(models.Review.created_at.desc())
            .limit(50)
        ).all()
        jobs = session.scalars(select(models.Job).where(models.Job.session_id == session_id).order_by(models.Job.updated_at.desc()).limit(100)).all()
        jobs_by_status = dict(
            session.execute(
                select(models.Job.status, func.count(models.Job.id)).where(models.Job.session_id == session_id).group_by(models.Job.status)
            ).all()
        )
        workers = session.scalars(select(models.Worker).order_by(models.Worker.last_seen_at.desc()).limit(50)).all()
        worker_events = session.scalars(select(models.WorkerEvent).order_by(models.WorkerEvent.created_at.desc()).limit(25)).all()
        audit_events = session.scalars(select(models.AuditEvent).order_by(models.AuditEvent.created_at.desc()).limit(100)).all()

    snapshot = {
        "type": "session_snapshot",
        "scope": "session",
        "sessionId": session_id,
        "applications": [application_to_read(application) for application in applications],
        "reviews": [review_to_read(review) for review in reviews],
        "jobs": [job_to_read(job) for job in jobs],
        "jobsByStatus": jobs_by_status,
        "workers": [worker_to_read(worker) for worker in workers],
        "events": [worker_event_to_read(event) for event in worker_events],
        "auditEvents": [audit_event_to_read(event) for event in audit_events],
    }
    snapshot["signature"] = snapshot_signature(snapshot)
    return jsonable_encoder(snapshot)


def worker_snapshot(websocket: WebSocket, worker_id: str) -> dict[str, Any]:
    session_factory = websocket.app.state.session_factory
    with session_factory() as session:
        worker = session.get(models.Worker, worker_id)
        jobs = session.scalars(select(models.Job).where(models.Job.assigned_worker_id == worker_id).order_by(models.Job.updated_at.desc()).limit(50)).all()
        worker_events = session.scalars(
            select(models.WorkerEvent).where(models.WorkerEvent.worker_id == worker_id).order_by(models.WorkerEvent.created_at.desc()).limit(25)
        ).all()

    snapshot = {
        "type": "worker_snapshot",
        "scope": "worker",
        "workerId": worker_id,
        "workers": [worker_to_read(worker)] if worker else [],
        "jobs": [job_to_read(job) for job in jobs],
        "events": [worker_event_to_read(event) for event in worker_events],
        "applications": [],
        "reviews": [],
        "auditEvents": [],
    }
    snapshot["signature"] = snapshot_signature(snapshot)
    return jsonable_encoder(snapshot)


def snapshot_signature(snapshot: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in ("applications", "reviews", "jobs", "workers", "auditEvents"):
        records = snapshot.get(key, [])
        parts.append(",".join(f"{record.get('id')}:{record_signature(record)}" for record in records))
    parts.append(",".join(event.get("id", "") for event in snapshot.get("events", [])[:8]))
    return "|".join(parts)


def live_events(previous: dict[str, Any] | None, current: dict[str, Any]) -> list[dict[str, Any]]:
    if previous is None:
        return []
    events: list[dict[str, Any]] = []
    for resource in LIVE_RESOURCES:
        previous_records = records_by_id(previous.get(resource, []))
        current_records = records_by_id(current.get(resource, []))
        for record_id, record in current_records.items():
            before = previous_records.get(record_id)
            if before is None:
                events.append(live_event(resource, record, created_event_name(resource, record), "created", before=None))
            elif record_signature(before) != record_signature(record):
                event_name = updated_event_name(resource, before, record)
                events.append(live_event(resource, record, event_name, "updated", before=before))
    return events


def records_by_id(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(record["id"]): record for record in records if record.get("id") is not None}


def record_signature(record: dict[str, Any]) -> str:
    return json.dumps(record, sort_keys=True, separators=(",", ":"), default=str)


def live_event(resource: str, record: dict[str, Any], event_name: str, event_type: str, before: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "channel": CHANNELS[resource],
        "type": event_type,
        "event": event_name,
        "resource": resource,
        "id": record.get("id"),
        "ids": [record.get("id")] if record.get("id") is not None else [],
        "record": record,
        "before": before,
        "date": datetime.now(timezone.utc).isoformat(),
    }


def created_event_name(resource: str, record: dict[str, Any]) -> str:
    if resource == "applications":
        return "application.created"
    if resource == "reviews":
        return "review.started"
    if resource == "jobs":
        return "job.completed" if record.get("status") == "completed" else "job.failed" if record.get("status") == "failed" else "job.queued"
    if resource == "workers":
        return "worker.registered"
    if resource == "auditEvents":
        return "audit.created"
    return f"{resource}.created"


def updated_event_name(resource: str, before: dict[str, Any], record: dict[str, Any]) -> str:
    if resource == "applications":
        return "application.updated"
    if resource == "reviews":
        if record.get("completedAt") or record.get("status") in {"pass", "fail", "completed", "PASS", "FAIL"}:
            return "review.completed"
        if before.get("status") != record.get("status"):
            return "review.progress"
        return "review.progress"
    if resource == "jobs":
        if record.get("status") == "completed":
            return "job.completed"
        if record.get("status") == "failed":
            return "job.failed"
        if before.get("assignedWorkerId") != record.get("assignedWorkerId") and record.get("assignedWorkerId"):
            return "job.assigned"
        return "job.progress"
    if resource == "workers":
        if record.get("status") in {"offline", "lost"}:
            return "worker.lost"
        return "worker.heartbeat"
    if resource == "auditEvents":
        return "audit.created"
    return f"{resource}.updated"
