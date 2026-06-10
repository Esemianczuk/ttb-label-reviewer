from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select

from .. import models
from ..api.serializers import review_to_read, worker_event_to_read, worker_to_read

router = APIRouter(tags=["websockets"])


@router.websocket("/api/ws/sessions/{session_id}")
async def session_progress(websocket: WebSocket, session_id: str):
    await websocket.accept()
    await websocket.send_json({"type": "connected", "scope": "session", "sessionId": session_id})
    last_signature = None
    try:
        while True:
            try:
                message = await asyncio.wait_for(websocket.receive_text(), timeout=1.0)
                await websocket.send_json({"type": "echo", "scope": "session", "sessionId": session_id, "message": message})
            except asyncio.TimeoutError:
                snapshot = session_snapshot(websocket, session_id)
                signature = snapshot["signature"]
                if signature != last_signature:
                    last_signature = signature
                    await websocket.send_json(snapshot)
    except WebSocketDisconnect:
        return


@router.websocket("/api/ws/workers/{worker_id}")
async def worker_progress(websocket: WebSocket, worker_id: str):
    await websocket.accept()
    await websocket.send_json({"type": "connected", "scope": "worker", "workerId": worker_id})
    try:
        while True:
            message = await websocket.receive_text()
            await websocket.send_json({"type": "echo", "scope": "worker", "workerId": worker_id, "message": message})
    except WebSocketDisconnect:
        return


def session_snapshot(websocket: WebSocket, session_id: str):
    session_factory = websocket.app.state.session_factory
    with session_factory() as session:
        reviews = session.scalars(
            select(models.Review)
            .join(models.Application)
            .where(models.Application.session_id == session_id)
            .order_by(models.Review.created_at.desc())
            .limit(8)
        ).all()
        jobs_by_status = dict(
            session.execute(
                select(models.Job.status, func.count(models.Job.id)).where(models.Job.session_id == session_id).group_by(models.Job.status)
            ).all()
        )
        workers = session.scalars(select(models.Worker).order_by(models.Worker.last_seen_at.desc()).limit(20)).all()
        events = session.scalars(select(models.WorkerEvent).order_by(models.WorkerEvent.created_at.desc()).limit(12)).all()

    signature = "|".join(
        [
            ",".join(f"{review.id}:{review.status}:{review.completed_at}" for review in reviews),
            ",".join(f"{key}:{jobs_by_status[key]}" for key in sorted(jobs_by_status)),
            ",".join(f"{worker.id}:{worker.active_jobs}:{worker.status}:{worker.last_seen_at}" for worker in workers),
            ",".join(event.id for event in events[:4]),
        ]
    )
    return {
        "type": "session_snapshot",
        "scope": "session",
        "sessionId": session_id,
        "reviews": [review_to_read(review) for review in reviews],
        "jobsByStatus": jobs_by_status,
        "workers": [worker_to_read(worker) for worker in workers],
        "events": [worker_event_to_read(event) for event in events],
        "signature": signature,
    }
