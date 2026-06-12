from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from apps.api.app.config import Settings
from apps.api.app.main import create_app
from apps.api.app.tests.helpers import PNG_1X1_BYTES, auth_headers
from ttb_worker.capabilities import probe_capabilities
from ttb_worker.agent import WorkerAgent, WorkerConfig, resolve_concurrency
from ttb_worker.engines.tesseract_engine import TesseractEngine
from ttb_worker.heartbeat import HeartbeatCadence
from ttb_worker.engines.null_engine import NullOcrEngine
from ttb_worker.transport import CoordinatorClient


PNG_BYTES = PNG_1X1_BYTES


@pytest.fixture()
def api_client(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'api.sqlite3'}",
        data_dir=tmp_path / "data",
        static_dir=tmp_path / "missing-dist",
    )
    app = create_app(settings=settings)
    with TestClient(app) as client:
        yield client


def create_review(api_client: TestClient) -> dict:
    application_response = api_client.post(
        "/api/applications",
        json={
            "source": "upload",
            "expectedFields": {
                "productType": "distilled_spirits",
                "brandName": "Hollow Ridge",
                "fancifulName": "Single Barrel",
                "classType": "Bourbon Whiskey",
                "alcoholContent": "45% alc/vol",
                "netContents": "750 mL",
                "governmentWarningRequired": True,
                "producerName": "Hollow Ridge Distilling",
                "countryOfOrigin": "United States",
            },
            "metadata": {"notes": "worker integration test"},
        },
        headers=auth_headers(api_client, "applicant", "worker-session"),
    )
    assert application_response.status_code == 201, application_response.text
    application = application_response.json()

    image_response = api_client.post(
        f"/api/applications/{application['id']}/images",
        headers=auth_headers(api_client, "applicant", "worker-session"),
        data={"role": "front"},
        files={"file": ("front.png", PNG_BYTES, "image/png")},
    )
    assert image_response.status_code == 201, image_response.text

    review_response = api_client.post(
        f"/api/applications/{application['id']}/review",
        headers=auth_headers(api_client, "reviewer", "worker-session"),
        json={"mode": "distributed"},
    )
    assert review_response.status_code == 201, review_response.text
    return review_response.json()


def create_join_token(api_client: TestClient) -> str:
    response = api_client.post("/api/cluster/join-token", headers=auth_headers(api_client, "admin"), json={"ttlSeconds": 300})
    assert response.status_code == 201, response.text
    return response.json()["token"]


def worker_auth(secret: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}"}


def worker_agent(api_client: TestClient, tmp_path: Path) -> WorkerAgent:
    join_token = create_join_token(api_client)
    client = CoordinatorClient("http://testserver", session_id="worker-session", join_token=join_token, http_client=api_client)
    capabilities = {
        "hostname": "pytest-host",
        "platform": "linux",
        "arch": "x86_64",
        "cpuCount": 2,
        "memory": {"totalBytes": 1024, "availableBytes": 512},
        "accelerators": {"cuda": {"available": False, "devices": []}, "appleMps": {"available": False}},
        "ocr": {},
        "supportedImageFormats": ["png"],
    }
    return WorkerAgent(
        WorkerConfig(
            coordinator="http://testserver",
            name="worker-pytest",
            concurrency=1,
            engines="null",
            data_dir=tmp_path / ".worker-cache",
            session_id="worker-session",
            join_token=join_token,
            secret_file=tmp_path / ".worker-cache" / "worker-secret.txt",
        ),
        client=client,
        engines=[NullOcrEngine()],
        capabilities=capabilities,
    )


def test_worker_processes_fake_review_end_to_end(api_client: TestClient, tmp_path: Path):
    review = create_review(api_client)
    agent = worker_agent(api_client, tmp_path)

    assert agent.register()["id"] == "worker-pytest"
    assert agent.client.worker_secret
    assert (tmp_path / ".worker-cache" / "worker-secret.txt").exists()
    recalibrate = api_client.post("/api/workers/worker-pytest/recalibrate", headers=worker_auth(agent.client.worker_secret))
    assert recalibrate.json()["calibration"]["recalibrationStatus"] == "requested"

    assert agent.run_once() is True
    assert api_client.get(f"/api/reviews/{review['id']}", headers=auth_headers(api_client, "reviewer", "worker-session")).json()["status"] == "processing"
    assert agent.run_once() is True
    assert agent.run_once() is True

    completed = api_client.get(f"/api/reviews/{review['id']}", headers=auth_headers(api_client, "reviewer", "worker-session")).json()
    assert completed["status"] == "pass"
    assert completed["result"]["overallStatus"] == "PASS"
    assert {field["fieldKey"] for field in completed["result"]["fields"]} >= {"brandName", "classType", "alcoholContent"}

    report = api_client.get(f"/api/reports/{review['id']}.json", headers=auth_headers(api_client, "reviewer", "worker-session")).json()
    assert report["result"]["workersUsed"] == [{"workerId": "worker-pytest", "mode": "distributed"}]
    assert agent.run_once() is False


def test_worker_reports_retryable_failures_to_coordinator(api_client: TestClient, tmp_path: Path):
    create_review(api_client)
    agent = worker_agent(api_client, tmp_path)
    agent.engines = [_FailingOcrEngine()]

    assert agent.run_once() is False

    jobs = api_client.get("/api/jobs?limit=10", headers=auth_headers(api_client, "admin", "worker-session")).json()
    ocr_job = next(job for job in jobs if job["jobType"] == "ocr")
    assert ocr_job["status"] == "queued"
    assert ocr_job["assignedWorkerId"] is None
    assert "RuntimeError: simulated OCR failure" in ocr_job["error"]


def test_capability_probe_and_heartbeat_cadence_are_deterministic(tmp_path: Path, monkeypatch):
    class Response:
        content = b'{"ok":true}'

        def raise_for_status(self):
            return None

    monkeypatch.setattr("ttb_worker.capabilities.httpx.get", lambda *_args, **_kwargs: Response())

    capabilities = probe_capabilities("http://coordinator.test", tmp_path / "probe-cache")
    assert capabilities["network"]["status"] == "ok"
    assert capabilities["cpuCount"] >= 1
    assert "tesseractBinary" in capabilities["ocr"]
    assert capabilities["supportedImageFormats"]

    cadence = HeartbeatCadence(interval_seconds=30)
    assert cadence.due() is True
    cadence.mark_sent()
    assert cadence.due() is False
    cadence.last_sent -= 31
    assert cadence.due() is True


def test_tesseract_healthcheck_reports_unavailable_without_binary(monkeypatch):
    monkeypatch.setattr("ttb_worker.engines.tesseract_engine.which", lambda _name: None)

    health = TesseractEngine().healthcheck()

    assert health.available is False
    assert health.status == "unavailable"
    assert "not on PATH" in (health.detail or "")


def test_worker_probe_and_cli_helpers(tmp_path: Path):
    assert resolve_concurrency("auto") >= 1
    assert resolve_concurrency("3") == 3

    agent = WorkerAgent(
        WorkerConfig(
            coordinator="http://unreachable.test",
            name="worker-probe",
            concurrency="auto",
            engines="null",
            data_dir=tmp_path / ".worker-cache",
            join_token="ttb_join_test",
        ),
        client=CoordinatorClient("http://unreachable.test", join_token="ttb_join_test", http_client=_NoopClient()),
        engines=[NullOcrEngine()],
        capabilities={"hostname": "probe", "platform": "linux", "arch": "x86_64"},
    )
    assert agent.supported_job_types() == ["ocr", "evidence_crop", "validation"]
    assert (tmp_path / ".worker-cache" / "calibration.json").exists()


class _NoopClient:
    def close(self):
        return None


class _FailingOcrEngine(NullOcrEngine):
    id = "failing-null"

    def recognize(self, image_bytes: bytes, options: dict | None = None):
        raise RuntimeError("simulated OCR failure")
