from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from apps.api.app.config import Settings
from apps.api.app.main import create_app


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


def create_application(client: TestClient, session_id: str = "session-a", name: str = "Hollow Ridge") -> dict:
    response = client.post("/api/applications", json=app_payload(name), headers=headers(session_id))
    assert response.status_code == 201, response.text
    return response.json()


def upload_image(client: TestClient, application_id: str, session_id: str = "session-a", data: bytes = PNG_BYTES) -> dict:
    response = client.post(
        f"/api/applications/{application_id}/images",
        headers=headers(session_id),
        data={"role": "front"},
        files={"file": ("../../front label.png", data, "image/png")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def register_worker(client: TestClient) -> dict:
    response = client.post(
        "/api/workers/register",
        json={
            "id": "worker-test-1",
            "hostname": "test-host",
            "platform": "linux",
            "arch": "x86_64",
            "version": "test",
            "maxConcurrency": 1,
            "capabilities": {"ocr": True, "evidence_crop": True, "validation": True},
            "calibration": {"ocrMs": 1},
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def claim_job(client: TestClient, expected_type: str) -> dict:
    response = client.post(
        "/api/workers/worker-test-1/claim",
        json={"sessionId": "session-a", "supportedJobTypes": ["ocr", "evidence_crop", "validation"]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["job"]["jobType"] == expected_type
    assert {"queued_job", "available_worker", "session_scoped"}.issubset(set(body["assignment"]["reason_codes"]))
    assert body["assignment"]["score_ms"] >= 0
    return body["job"]


def complete_job(client: TestClient, job_id: str, result: dict) -> dict:
    response = client.post("/api/workers/worker-test-1/complete", json={"jobId": job_id, "result": result})
    assert response.status_code == 200, response.text
    return response.json()


def test_health_and_application_session_scope(client: TestClient):
    assert client.get("/api/health").json()["ok"] is True

    application = create_application(client, session_id="session-a")
    assert application["assetCount"] == 0
    assert application["expectedFields"]["brandName"] == "Hollow Ridge"

    assert client.get("/api/applications", headers=headers("session-a")).json()[0]["id"] == application["id"]
    assert client.get("/api/applications", headers=headers("session-b")).json() == []
    assert client.get(f"/api/applications/{application['id']}", headers=headers("session-b")).status_code == 404


def test_asset_upload_is_sanitized_and_session_scoped(client: TestClient):
    application = create_application(client)
    asset = upload_image(client, application["id"])

    assert asset["originalFilename"] == "front_label.png"
    assert asset["mimeType"] == "image/png"
    assert client.get(f"/api/assets/{asset['id']}", headers=headers("session-b")).status_code == 404

    content = client.get(f"/api/assets/{asset['id']}/content", headers=headers("session-a"))
    assert content.status_code == 200
    assert content.content == PNG_BYTES

    other_application = create_application(client, name="Other Label")
    duplicate = client.post(
        f"/api/applications/{other_application['id']}/images",
        headers=headers("session-a"),
        data={"role": "front"},
        files={"file": ("front.png", PNG_BYTES, "image/png")},
    )
    assert duplicate.status_code == 409

    invalid = client.post(
        f"/api/applications/{application['id']}/images",
        headers=headers("session-a"),
        files={"file": ("notes.txt", b"not an image", "text/plain")},
    )
    assert invalid.status_code == 400


def test_review_queue_fake_worker_and_report_flow(client: TestClient):
    application = create_application(client)
    upload_image(client, application["id"])

    review_response = client.post(f"/api/applications/{application['id']}/review", json={"mode": "distributed"}, headers=headers())
    assert review_response.status_code == 201, review_response.text
    review = review_response.json()
    assert review["status"] == "queued"

    register_worker(client)

    ocr_job = claim_job(client, "ocr")
    heartbeat = client.post("/api/workers/worker-test-1/heartbeat", json={"activeJobs": 1, "status": "online"})
    assert heartbeat.status_code == 200
    complete_job(client, ocr_job["id"], {"text": "Hollow Ridge", "status": "OCR_DONE"})
    assert client.get(f"/api/reviews/{review['id']}", headers=headers()).json()["status"] == "processing"

    evidence_job = claim_job(client, "evidence_crop")
    complete_job(client, evidence_job["id"], {"crops": [{"field": "brandName", "confidence": 0.99}]})

    validation_job = claim_job(client, "validation")
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
    complete_job(client, validation_job["id"], final_result)

    review_after = client.get(f"/api/reviews/{review['id']}", headers=headers()).json()
    assert review_after["status"] == "pass"
    assert review_after["result"]["overallStatus"] == "PASS"

    report = client.get(f"/api/reports/{review['id']}.json", headers=headers())
    assert report.status_code == 200
    assert report.json()["result"]["fields"][0]["status"] == "PASS"
    assert client.get(f"/api/reports/{review['id']}.json", headers=headers("session-b")).status_code == 404

    empty_claim = client.post(
        "/api/workers/worker-test-1/claim",
        json={"sessionId": "session-a", "supportedJobTypes": ["ocr", "evidence_crop", "validation"]},
    ).json()
    assert empty_claim == {"job": None, "assignment": None}


def test_job_cancel_releases_worker_capacity(client: TestClient):
    application = create_application(client)
    upload_image(client, application["id"], data=b"\x89PNG\r\n\x1a\ncancel")
    review = client.post(f"/api/applications/{application['id']}/review", json={}, headers=headers()).json()
    register_worker(client)
    job = claim_job(client, "ocr")

    cancelled = client.post(f"/api/jobs/{job['id']}/cancel", headers=headers()).json()
    assert cancelled["status"] == "cancelled"
    assert cancelled["assignedWorkerId"] is None
    assert client.get(f"/api/jobs/{job['id']}", headers=headers("session-b")).status_code == 404
    assert client.get(f"/api/reviews/{review['id']}", headers=headers()).status_code == 200
    assert client.get("/api/workers/worker-test-1").json()["activeJobs"] == 0


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
