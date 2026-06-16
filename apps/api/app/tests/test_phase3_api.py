from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from apps.api.app import models
from apps.api.app.config import Settings
from apps.api.app.db import init_db, make_session_factory
from apps.api.app.main import create_app
from apps.api.app.tests.helpers import PNG_1X1_BYTES, auth_headers


REPO_ROOT = Path(__file__).resolve().parents[4]
PNG_BYTES = PNG_1X1_BYTES


def headers(session_id: str = "session-a") -> dict[str, str]:
    return {"X-Session-Id": session_id}


def app_payload(name: str = "Hollow Ridge") -> dict:
    return {
        "source": "upload",
        "expectedFields": {
            "productType": "distilled_spirits",
            "brandName": name,
            "fancifulName": "Single Barrel",
            "classType": "Bourbon Whiskey",
            "alcoholContent": "45% alc/vol",
            "netContents": "750 mL",
            "governmentWarningRequired": True,
            "producerName": "Hollow Ridge Distilling",
            "countryOfOrigin": "United States",
            "applicationId": "ABC12345678901",
            "labelId": "front",
        },
        "metadata": {"notes": "phase 3 test packet", "ttbId": "ABC12345678901"},
    }


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


def create_application(client: TestClient, session_id: str = "session-a", name: str = "Hollow Ridge", role: str = "applicant") -> dict:
    response = client.post("/api/applications", json=app_payload(name), headers=auth_headers(client, role, session_id))
    assert response.status_code == 201, response.text
    return response.json()


def upload_image(client: TestClient, application_id: str, session_id: str = "session-a", data: bytes = PNG_BYTES, role: str = "applicant") -> dict:
    response = client.post(
        f"/api/applications/{application_id}/images",
        headers=auth_headers(client, role, session_id),
        data={"role": "front"},
        files={"file": ("../../front label.png", data, "image/png")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_join_token(client: TestClient) -> str:
    response = client.post("/api/workers/join-token", json={"ttlSeconds": 300}, headers=auth_headers(client, "admin"))
    assert response.status_code == 201, response.text
    body = response.json()
    assert "python -m ttb_worker" in body["command"]
    return body["token"]


def worker_auth(secret: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}"}


def register_worker(client: TestClient) -> dict:
    response = client.post(
        "/api/workers/register",
        json={
            "id": "worker-test-1",
            "hostname": "test-host",
            "platform": "linux",
            "arch": "x86_64",
            "version": "test",
            "joinToken": create_join_token(client),
            "maxConcurrency": 1,
            "capabilities": {"ocr": True, "evidence_crop": True, "validation": True},
            "calibration": {"ocrMs": 1},
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["workerSecret"].startswith("ttb_worker_")
    return response.json()


def claim_job(client: TestClient, expected_type: str, secret: str) -> dict:
    response = client.post(
        "/api/workers/worker-test-1/claim",
        headers=worker_auth(secret),
        json={"sessionId": "session-a", "supportedJobTypes": ["ocr", "evidence_crop", "validation"]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["job"]["jobType"] == expected_type
    assert {"queued_job", "available_worker", "session_scoped"}.issubset(set(body["assignment"]["reason_codes"]))
    assert body["assignment"]["score_ms"] >= 0
    return body["job"]


def complete_job(client: TestClient, job_id: str, result: dict, secret: str) -> dict:
    response = client.post("/api/workers/worker-test-1/complete", headers=worker_auth(secret), json={"jobId": job_id, "result": result})
    assert response.status_code == 200, response.text
    return response.json()


def test_health_and_application_session_scope(client: TestClient):
    assert client.get("/api/health").json()["ok"] is True

    application = create_application(client, session_id="session-a")
    assert application["assetCount"] == 0
    assert application["ownerUserId"]
    assert application["versionCount"] == 1
    assert application["expectedFields"]["brandName"] == "Hollow Ridge"
    assert application["metadata"]["applicationNumber"] == "TTB-2026-0001"

    assert client.get("/api/applications", headers=auth_headers(client, "applicant", "session-a")).json()[0]["id"] == application["id"]
    assert client.get("/api/applications").status_code == 401
    assert client.get(f"/api/applications/{application['id']}", headers=auth_headers(client, "admin", "session-b")).status_code == 404


def test_public_demo_fixtures_are_private_per_console_session(client: TestClient):
    public_id = "app-ttb-19337001000251"
    alpha_headers = auth_headers(client, "reviewer", "console-alpha")
    beta_headers = auth_headers(client, "reviewer", "console-beta")

    alpha_apps = client.get("/api/applications", headers=alpha_headers)
    beta_apps = client.get("/api/applications", headers=beta_headers)
    assert alpha_apps.status_code == 200, alpha_apps.text
    assert beta_apps.status_code == 200, beta_apps.text
    alpha_rows = alpha_apps.json()
    beta_rows = beta_apps.json()
    assert len(alpha_rows) == len(beta_rows) >= 50
    assert {row["id"] for row in alpha_rows}.isdisjoint({row["id"] for row in beta_rows})
    assert {row["sessionId"] for row in alpha_rows} == {"console-alpha"}
    assert {row["sessionId"] for row in beta_rows} == {"console-beta"}

    alpha_application = client.get(f"/api/applications/{public_id}", headers=alpha_headers)
    beta_application = client.get(f"/api/applications/{public_id}", headers=beta_headers)
    assert alpha_application.status_code == 200, alpha_application.text
    assert beta_application.status_code == 200, beta_application.text
    assert alpha_application.json()["id"] != beta_application.json()["id"]
    assert alpha_application.json()["metadata"]["publicApplicationId"] == public_id
    assert beta_application.json()["metadata"]["publicApplicationId"] == public_id

    alpha_review = client.post(f"/api/applications/{public_id}/review", headers=alpha_headers, json={"mode": "backend"})
    assert alpha_review.status_code == 201, alpha_review.text
    assert alpha_review.json()["applicationId"] == alpha_application.json()["id"]
    assert client.get("/api/jobs", headers=auth_headers(client, "admin", "console-alpha")).json()
    assert client.get("/api/jobs", headers=auth_headers(client, "admin", "console-beta")).json() == []
    assert client.get(f"/api/reviews/{alpha_review.json()['id']}", headers=beta_headers).status_code == 404


def test_parallel_first_demo_fixture_request_reuses_seeded_session(tmp_path, monkeypatch):
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'race.sqlite3'}",
        data_dir=tmp_path / "data",
        static_dir=tmp_path / "missing-dist",
    )
    session_factory = make_session_factory(settings)
    init_db(session_factory)

    from apps.api.app.core import demo_fixtures

    monkeypatch.setattr(demo_fixtures, "get_settings", lambda: settings)
    original_seed_record = demo_fixtures.seed_record
    first_seed_barrier = threading.Barrier(2)
    first_seed_threads: set[int] = set()
    first_seed_lock = threading.Lock()

    def synchronized_seed_record(*args, **kwargs):
        thread_id = threading.get_ident()
        with first_seed_lock:
            should_wait = thread_id not in first_seed_threads
            first_seed_threads.add(thread_id)
        if should_wait:
            first_seed_barrier.wait(timeout=10)
        return original_seed_record(*args, **kwargs)

    monkeypatch.setattr(demo_fixtures, "seed_record", synchronized_seed_record)

    def seed_in_session() -> int:
        with session_factory() as db:
            demo_fixtures.ensure_demo_session(db, "console-parallel-race")
            return db.scalar(
                select(func.count(models.Application.id)).where(
                    models.Application.session_id == "console-parallel-race",
                    models.Application.source == "public_cola_registry",
                )
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        seeded_counts = list(executor.map(lambda _: seed_in_session(), range(2)))

    assert min(seeded_counts) >= 50
    with session_factory() as db:
        application_ids = db.scalars(
            select(models.Application.id).where(
                models.Application.session_id == "console-parallel-race",
                models.Application.source == "public_cola_registry",
            )
        ).all()
        assert len(application_ids) == len(set(application_ids))


def test_asset_upload_is_sanitized_and_session_scoped(client: TestClient):
    application = create_application(client)
    asset = upload_image(client, application["id"])

    assert asset["originalFilename"] == "front_label.png"
    assert asset["mimeType"] == "image/png"
    assert client.get(f"/api/assets/{asset['id']}").status_code == 401

    content = client.get(f"/api/assets/{asset['id']}/content", headers=auth_headers(client, "applicant", "session-a"))
    assert content.status_code == 200
    assert content.content == PNG_BYTES

    other_application = create_application(client, name="Other Label")
    duplicate = upload_image(client, other_application["id"], data=PNG_BYTES)
    assert duplicate["id"] != asset["id"]
    assert duplicate["sha256"] == asset["sha256"]
    assert duplicate["applicationId"] == other_application["id"]

    invalid = client.post(
        f"/api/applications/{application['id']}/images",
        headers=auth_headers(client, "applicant", "session-a"),
        files={"file": ("notes.txt", b"not an image", "text/plain")},
    )
    assert invalid.status_code == 400


def test_review_queue_fake_worker_and_report_flow(client: TestClient):
    application = create_application(client)
    upload_image(client, application["id"])

    review_response = client.post(f"/api/applications/{application['id']}/review", json={"mode": "backend"}, headers=auth_headers(client, "reviewer"))
    assert review_response.status_code == 201, review_response.text
    review = review_response.json()
    assert review["status"] == "queued"

    worker = register_worker(client)
    secret = worker["workerSecret"]

    validation_job = claim_job(client, "validation", secret)
    assert validation_job["payload"]["asset_ids"]
    assert "completed_ocr_results" not in validation_job["payload"]
    final_result = {
        "overallStatus": "PASS",
        "review_result": {
            "overallStatus": "PASS",
            "fields": [
                {
                    "fieldKey": "brandName",
                    "expected": "Hollow Ridge",
                    "extracted": "Hollow Ridge",
                    "status": "PASS",
                    "reason": "Exact match from OCR evidence.",
                }
            ],
            "notes": "Fake worker completed deterministic validation.",
        },
    }
    complete_job(client, validation_job["id"], final_result, secret)

    review_after = client.get(f"/api/reviews/{review['id']}", headers=auth_headers(client, "reviewer")).json()
    assert review_after["status"] == "pass"
    assert review_after["result"]["overallStatus"] == "PASS"

    events = client.get("/api/workers/events?limit=10", headers=auth_headers(client, "admin")).json()
    assert events[0]["eventType"] == "job_completed"
    assert any(event["eventType"] == "job_claimed" for event in events)
    assert events[0]["payload"]["job_id"] == validation_job["id"]

    report = client.get(f"/api/reports/{review['id']}.json", headers=auth_headers(client, "reviewer"))
    assert report.status_code == 200
    assert report.json()["result"]["fields"][0]["status"] == "PASS"
    assert client.get(f"/api/reports/{review['id']}.json").status_code == 401

    empty_claim = client.post(
        "/api/workers/worker-test-1/claim",
        headers=worker_auth(secret),
        json={"sessionId": "session-a", "supportedJobTypes": ["ocr", "evidence_crop", "validation"]},
    ).json()
    assert empty_claim == {"job": None, "assignment": None}


def test_job_cancel_releases_worker_capacity(client: TestClient):
    application = create_application(client)
    upload_image(client, application["id"])
    review = client.post(f"/api/applications/{application['id']}/review", json={}, headers=auth_headers(client, "reviewer")).json()
    worker = register_worker(client)
    secret = worker["workerSecret"]
    job = claim_job(client, "validation", secret)

    cancelled = client.post(f"/api/jobs/{job['id']}/cancel", headers=auth_headers(client, "admin")).json()
    assert cancelled["status"] == "cancelled"
    assert cancelled["assignedWorkerId"] is None
    assert client.get(f"/api/jobs/{job['id']}", headers=auth_headers(client, "applicant", "session-b")).status_code == 404
    assert client.get(f"/api/reviews/{review['id']}", headers=auth_headers(client, "reviewer")).status_code == 200
    assert client.get("/api/workers/worker-test-1", headers=auth_headers(client, "admin")).json()["activeJobs"] == 0


def test_admin_operations_endpoints_manage_backend_jobs_settings_and_workers(client: TestClient):
    application = create_application(client)
    upload_image(client, application["id"])
    review_response = client.post(f"/api/applications/{application['id']}/review", json={}, headers=auth_headers(client, "reviewer"))
    assert review_response.status_code == 201, review_response.text

    admin_headers = auth_headers(client, "admin")
    jobs = client.get("/api/jobs?limit=10", headers=admin_headers)
    assert jobs.status_code == 200, jobs.text
    assert jobs.json()
    job = jobs.json()[0]

    raised = client.post(f"/api/jobs/{job['id']}/raise-priority", headers=admin_headers)
    assert raised.status_code == 200, raised.text
    assert raised.json()["priority"] > job["priority"]

    retried = client.post(f"/api/jobs/{job['id']}/retry", headers=admin_headers)
    assert retried.status_code == 200, retried.text
    assert retried.json()["status"] == "queued"

    cancelled = client.post(f"/api/jobs/{job['id']}/cancel", headers=admin_headers)
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"

    settings = client.get("/api/settings", headers=admin_headers)
    assert settings.status_code == 200, settings.text
    assert any(setting["key"] == "admin.operations" for setting in settings.json())

    updated = client.patch("/api/settings/admin.operations", json={"value": {"maxConcurrency": 7}}, headers=admin_headers)
    assert updated.status_code == 200, updated.text
    assert updated.json()["value"]["maxConcurrency"] == 7
    assert updated.json()["value"]["preferredOcrEngine"] == "paddleocr"

    ocr_status = client.get("/api/admin/ocr-model-status", headers=admin_headers)
    assert ocr_status.status_code == 200, ocr_status.text
    assert ocr_status.json()[0]["id"] == "paddleocr-field-alignment"
    assert ocr_status.json()[0]["mode"] == "paddleocr-weak-field-alignment"

    worker = register_worker(client)
    drained = client.post(f"/api/workers/{worker['id']}/drain", headers=admin_headers)
    assert drained.status_code == 200, drained.text
    assert drained.json()["calibration"]["drainMode"] is True

    disabled = client.post(f"/api/workers/{worker['id']}/disable", headers=admin_headers)
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["status"] == "disabled"

    enabled = client.post(f"/api/workers/{worker['id']}/enable", headers=admin_headers)
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["calibration"]["disabled"] is False

    audit = client.get("/api/audit-events?limit=20", headers=admin_headers)
    assert audit.status_code == 200, audit.text
    event_types = {event["eventType"] for event in audit.json()}
    assert {"settings.update", "worker.disable", "job.cancel"}.issubset(event_types)

    purged = client.post("/api/admin/retention/purge-old-jobs", headers=admin_headers)
    assert purged.status_code == 200, purged.text
    assert purged.json()["count"] >= 1


def test_websocket_progress_smoke(client: TestClient):
    with client.websocket_connect("/api/ws/sessions/session-a") as websocket:
        assert websocket.receive_json() == {"type": "connected", "scope": "session", "sessionId": "session-a"}
        assert websocket.receive_json()["type"] == "session_snapshot"
        websocket.send_text("ping")
        assert receive_message_type(websocket, "echo")["message"] == "ping"


def test_phase12_session_websocket_emits_live_resource_events(client: TestClient):
    with client.websocket_connect("/api/ws/sessions/session-a") as websocket:
        assert websocket.receive_json()["type"] == "connected"
        assert websocket.receive_json()["type"] == "session_snapshot"

        application = create_application(client)
        assert "application.created" in collect_live_events(websocket, {"application.created"})

        upload_image(client, application["id"])
        review_response = client.post(f"/api/applications/{application['id']}/review", json={}, headers=auth_headers(client, "reviewer"))
        assert review_response.status_code == 201, review_response.text
        assert {"review.started", "job.queued"}.issubset(collect_live_events(websocket, {"review.started", "job.queued"}))

        worker = register_worker(client)
        secret = worker["workerSecret"]
        heartbeat = client.post("/api/workers/worker-test-1/heartbeat", headers=worker_auth(secret), json={"activeJobs": 1, "status": "online"})
        assert heartbeat.status_code == 200, heartbeat.text
        assert "worker.registered" in collect_live_events(websocket, {"worker.registered"})

        heartbeat = client.post("/api/workers/worker-test-1/heartbeat", headers=worker_auth(secret), json={"activeJobs": 0, "status": "online"})
        assert heartbeat.status_code == 200, heartbeat.text
        assert "worker.heartbeat" in collect_live_events(websocket, {"worker.heartbeat"})

        job = claim_job(client, "validation", secret)
        assert "job.assigned" in collect_live_events(websocket, {"job.assigned"})

        complete_job(
            client,
            job["id"],
            {
                "overallStatus": "PASS",
                "review_result": {
                    "overallStatus": "PASS",
                    "fields": [{"fieldKey": "brandName", "status": "PASS", "expected": "Hollow Ridge", "extracted": "Hollow Ridge"}],
                },
            },
            secret,
        )
        assert "job.completed" in collect_live_events(websocket, {"job.completed"})

        settings = client.patch("/api/settings/admin.operations", json={"value": {"maxConcurrency": 5}}, headers=auth_headers(client, "admin"))
        assert settings.status_code == 200, settings.text
        assert "audit.created" in collect_live_events(websocket, {"audit.created"})


def test_phase12_worker_websocket_emits_worker_heartbeat(client: TestClient):
    worker = register_worker(client)
    secret = worker["workerSecret"]
    with client.websocket_connect(f"/api/ws/workers/{worker['id']}") as websocket:
        assert websocket.receive_json() == {"type": "connected", "scope": "worker", "workerId": worker["id"]}
        assert websocket.receive_json()["type"] == "worker_snapshot"
        heartbeat = client.post(f"/api/workers/{worker['id']}/heartbeat", headers=worker_auth(secret), json={"activeJobs": 1, "status": "online"})
        assert heartbeat.status_code == 200, heartbeat.text
        assert "worker.heartbeat" in collect_live_events(websocket, {"worker.heartbeat"})


def test_alembic_migration_runs_against_sqlite_fallback(tmp_path, monkeypatch):
    monkeypatch.setenv("TTB_API_DATABASE_URL", f"sqlite:///{tmp_path / 'migrated.sqlite3'}")
    monkeypatch.setenv("TTB_API_DATA_DIR", str(tmp_path / "data"))
    config = Config(str(REPO_ROOT / "apps/api/alembic.ini"))

    command.upgrade(config, "head")

    assert (tmp_path / "migrated.sqlite3").exists()


def receive_message_type(websocket, message_type: str, attempts: int = 8) -> dict:
    for _ in range(attempts):
        message = websocket.receive_json()
        if message.get("type") == message_type:
            return message
    raise AssertionError(f"Did not receive WebSocket message type {message_type}.")


def collect_live_events(websocket, expected: set[str], attempts: int = 10) -> set[str]:
    seen: set[str] = set()
    for _ in range(attempts):
        message = websocket.receive_json()
        if message.get("type") == "live_events":
            seen.update(event["event"] for event in message.get("events", []))
            if expected.issubset(seen):
                return seen
    raise AssertionError(f"Did not receive expected live events {expected}; saw {seen}.")
