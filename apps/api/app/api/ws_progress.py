from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["websockets"])


@router.websocket("/api/ws/sessions/{session_id}")
async def session_progress(websocket: WebSocket, session_id: str):
    await websocket.accept()
    await websocket.send_json({"type": "connected", "scope": "session", "sessionId": session_id})
    try:
        while True:
            message = await websocket.receive_text()
            await websocket.send_json({"type": "echo", "scope": "session", "sessionId": session_id, "message": message})
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
