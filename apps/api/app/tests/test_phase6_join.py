from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from apps.api.app.config import Settings
from apps.api.app.main import create_app


@pytest.fixture()
def client(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'api.sqlite3'}",
        data_dir=tmp_path / "data",
        static_dir=tmp_path / "missing-dist",
    )
    app = create_app(settings=settings)
    with TestClient(app) as test_client:
        yield test_client


def worker_payload(join_token: str | None = None) -> dict:
    payload = {
        "id": "join-worker-1",
        "hostname": "join-host",
        "platform": "linux",
        "arch": "x86_64",
        "version": "test",
        "maxConcurrency": 1,
        "capabilities": {"ocr": True, "supportedJobTypes": ["ocr"]},
        "calibration": {"engines": {"null": {"steadyStateMs": 1}}},
    }
    if join_token is not None:
        payload["joinToken"] = join_token
    return payload


def issue_join_token(client: TestClient, ttl_seconds: int = 300) -> dict:
    response = client.post("/api/cluster/join-token", json={"ttlSeconds": ttl_seconds, "coordinatorUrl": "http://127.0.0.1:8000"})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["token"].startswith("ttb_join_")
    assert "--join-token" in body["command"]
    return body


def auth(secret: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}"}


def test_manual_join_token_registers_worker_and_returns_secret(client: TestClient):
    assert client.get("/api/cluster/status").json()["mdnsService"] == "_ttb-label-reviewer._tcp.local."

    no_token = client.post("/api/workers/register", json=worker_payload())
    assert no_token.status_code == 401

    token = issue_join_token(client)["token"]
    registered = client.post("/api/workers/register", json=worker_payload(token))
    assert registered.status_code == 201, registered.text
    body = registered.json()
    assert body["id"] == "join-worker-1"
    assert body["workerSecret"].startswith("ttb_worker_")

    heartbeat_without_auth = client.post("/api/workers/join-worker-1/heartbeat", json={"activeJobs": 0, "status": "online"})
    assert heartbeat_without_auth.status_code == 401

    heartbeat = client.post(
        "/api/workers/join-worker-1/heartbeat",
        headers=auth(body["workerSecret"]),
        json={"activeJobs": 0, "status": "online"},
    )
    assert heartbeat.status_code == 200

    re_register = client.post("/api/workers/register", headers=auth(body["workerSecret"]), json=worker_payload())
    assert re_register.status_code == 201
    assert re_register.json()["workerSecret"] is None


def test_expired_join_token_is_rejected(client: TestClient):
    token = issue_join_token(client, ttl_seconds=-1)["token"]
    response = client.post("/api/workers/register", json=worker_payload(token))
    assert response.status_code == 401
