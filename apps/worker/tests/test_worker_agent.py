from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from apps.api.app.config import Settings
from apps.api.app.main import create_app
from ttb_worker.agent import WorkerAgent, WorkerConfig, resolve_concurrency
from ttb_worker.engines.null_engine import NullOcrEngine
from ttb_worker.transport import CoordinatorClient


PNG_BYTES = b"\x89PNG\r\n\x1a\nworker-phase-4"


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


def headers(session_id: str = "worker-session") -> dict[str, str]:
    return {"X-Session-Id": session_id}


def create_review(api_client: TestClient) -> dict:
    application_response = api_client.post(
        "/api/applications",
        headers=headers(),
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
    )
    assert application_response.status_code == 201, application_response.text
    application = application_response.json()

    image_response = api_client.post(
        f"/api/applications/{application['id']}/images",
        headers=headers(),
        data={"role": "front"},
        files={"file": ("front.png", PNG_BYTES, "image/png")},
    )
    assert image_response.status_code == 201, image_response.text

    review_response = api_client.post(f"/api/applications/{application['id']}/review", headers=headers(), json={"mode": "distributed"})
    assert review_response.status_code == 201, review_response.text
    return review_response.json()


def worker_agent(api_client: TestClient, tmp_path: Path) -> WorkerAgent:
    client = CoordinatorClient("http://testserver", session_id="worker-session", http_client=api_client)
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
        ),
        client=client,
        engines=[NullOcrEngine()],
        capabilities=capabilities,
    )


def test_worker_processes_fake_review_end_to_end(api_client: TestClient, tmp_path: Path):
    review = create_review(api_client)
    agent = worker_agent(api_client, tmp_path)

    assert agent.register()["id"] == "worker-pytest"
    assert api_client.post("/api/workers/worker-pytest/recalibrate").json()["calibration"]["recalibrationStatus"] == "requested"

    assert agent.run_once() is True
    assert api_client.get(f"/api/reviews/{review['id']}", headers=headers()).json()["status"] == "processing"
    assert agent.run_once() is True
    assert agent.run_once() is True

    completed = api_client.get(f"/api/reviews/{review['id']}", headers=headers()).json()
    assert completed["status"] == "pass"
    assert completed["result"]["overallStatus"] == "PASS"
    assert {field["fieldKey"] for field in completed["result"]["fields"]} >= {"brandName", "classType", "alcoholContent"}

    report = api_client.get(f"/api/reports/{review['id']}.json", headers=headers()).json()
    assert report["result"]["workersUsed"] == [{"id": "worker-pytest"}]
    assert agent.run_once() is False


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
        ),
        client=CoordinatorClient("http://unreachable.test", http_client=_NoopClient()),
        engines=[NullOcrEngine()],
        capabilities={"hostname": "probe", "platform": "linux", "arch": "x86_64"},
    )
    assert agent.supported_job_types() == ["ocr", "evidence_crop", "validation"]
    assert (tmp_path / ".worker-cache" / "calibration.json").exists()


class _NoopClient:
    def close(self):
        return None
