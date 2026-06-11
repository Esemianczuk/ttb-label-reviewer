from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from apps.api.app.config import Settings
from apps.api.app.main import create_app
from apps.api.app.tests.helpers import auth_headers


REPO_ROOT = Path(__file__).resolve().parents[4]
PNG_BYTES = b"\x89PNG\r\n\x1a\nphase-3-api-test"


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
    response = client.post("/api/cluster/join-token", json={"ttlSeconds": 300}, headers=auth_headers(client, "admin"))
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

    assert client.get("/api/applications", headers=auth_headers(client, "applicant", "session-a")).json()[0]["id"] == application["id"]
    assert client.get("/api/applications").status_code == 401
    assert client.get(f"/api/applications/{application['id']}", headers=auth_headers(client, "admin", "session-b")).status_code == 200


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

    review_response = client.post(f"/api/applications/{application['id']}/review", json={"mode": "distributed"}, headers=auth_headers(client, "reviewer"))
    assert review_response.status_code == 201, review_response.text
    review = review_response.json()
    assert review["status"] == "queued"

    worker = register_worker(client)
    secret = worker["workerSecret"]

    ocr_job = claim_job(client, "ocr", secret)
    heartbeat = client.post("/api/workers/worker-test-1/heartbeat", headers=worker_auth(secret), json={"activeJobs": 1, "status": "online"})
    assert heartbeat.status_code == 200
    complete_job(client, ocr_job["id"], {"text": "Hollow Ridge", "status": "OCR_DONE"}, secret)
    assert client.get(f"/api/reviews/{review['id']}", headers=auth_headers(client, "reviewer")).json()["status"] == "processing"

    evidence_job = claim_job(client, "evidence_crop", secret)
    complete_job(client, evidence_job["id"], {"crops": [{"field": "brandName", "confidence": 0.99}]}, secret)

    validation_job = claim_job(client, "validation", secret)
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
    upload_image(client, application["id"], data=b"\x89PNG\r\n\x1a\ncancel")
    review = client.post(f"/api/applications/{application['id']}/review", json={}, headers=auth_headers(client, "reviewer")).json()
    worker = register_worker(client)
    secret = worker["workerSecret"]
    job = claim_job(client, "ocr", secret)

    cancelled = client.post(f"/api/jobs/{job['id']}/cancel", headers=auth_headers(client, "admin")).json()
    assert cancelled["status"] == "cancelled"
    assert cancelled["assignedWorkerId"] is None
    assert client.get(f"/api/jobs/{job['id']}", headers=auth_headers(client, "applicant", "session-b")).status_code == 200
    assert client.get(f"/api/reviews/{review['id']}", headers=auth_headers(client, "reviewer")).status_code == 200
    assert client.get("/api/workers/worker-test-1", headers=auth_headers(client, "admin")).json()["activeJobs"] == 0


def test_admin_operations_endpoints_manage_backend_jobs_settings_and_workers(client: TestClient):
    application = create_application(client)
    upload_image(client, application["id"], data=b"\x89PNG\r\n\x1a\nadmin-ops")
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
    assert updated.json()["value"]["preferredOcrEngine"] == "browser-fixture"

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
        websocket.send_text("ping")
        assert websocket.receive_json()["message"] == "ping"


def test_alembic_migration_runs_against_sqlite_fallback(tmp_path, monkeypatch):
    monkeypatch.setenv("TTB_API_DATABASE_URL", f"sqlite:///{tmp_path / 'migrated.sqlite3'}")
    monkeypatch.setenv("TTB_API_DATA_DIR", str(tmp_path / "data"))
    config = Config(str(REPO_ROOT / "apps/api/alembic.ini"))

    command.upgrade(config, "head")

    assert (tmp_path / "migrated.sqlite3").exists()
