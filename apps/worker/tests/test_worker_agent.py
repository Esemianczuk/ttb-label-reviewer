from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from apps.api.app.config import Settings
from apps.api.app.main import create_app
from apps.api.app.tests.helpers import PNG_1X1_BYTES, auth_headers
from ttb_worker.capabilities import probe_capabilities
from ttb_worker.agent import WorkerAgent, WorkerConfig, resolve_concurrency
from ttb_worker.engines.base import EngineEstimate, EngineHealth, OcrResult
from ttb_worker.engines.paddleocr_engine import resolve_model_config
from ttb_worker.engines.tesseract_engine import TesseractEngine
from ttb_worker.heartbeat import HeartbeatCadence
from ttb_worker.engines.null_engine import GOVERNMENT_WARNING_TEXT, NullOcrEngine
from ttb_worker.tasks.evidence_task import normalize_bbox
from ttb_worker.tasks.ocr_task import choose_engine, process_ocr_job
from ttb_worker.tasks.validation_task import process_validation_job
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

    processed = 0
    saw_processing = False
    for _ in range(20):
        if not agent.run_once():
            break
        processed += 1
        current_status = api_client.get(f"/api/reviews/{review['id']}", headers=auth_headers(api_client, "reviewer", "worker-session")).json()["status"]
        if current_status == "processing":
            saw_processing = True
        if current_status == "pass":
            break
    assert processed >= 3
    assert saw_processing

    completed = api_client.get(f"/api/reviews/{review['id']}", headers=auth_headers(api_client, "reviewer", "worker-session")).json()
    assert completed["status"] == "pass"
    assert completed["result"]["overallStatus"] == "PASS"
    assert {field["fieldKey"] for field in completed["result"]["fields"]} >= {"brandName", "classType", "alcoholContent"}

    report = api_client.get(f"/api/reports/{review['id']}.json", headers=auth_headers(api_client, "reviewer", "worker-session")).json()
    assert report["result"]["workersUsed"] == [{"workerId": "worker-pytest", "mode": "distributed"}]
    assert agent.run_once() is False


def test_evidence_bbox_normalizes_easyocr_polygons():
    assert normalize_bbox([[10, 20], [110, 18], [112, 55], [9, 60]]) == {
        "x": 9.0,
        "y": 18.0,
        "width": 103.0,
        "height": 42.0,
    }


def test_worker_reports_retryable_failures_to_coordinator(api_client: TestClient, tmp_path: Path):
    create_review(api_client)
    agent = worker_agent(api_client, tmp_path)
    agent.engines = [_FailingOcrEngine()]

    assert agent.run_once() is False

    jobs = api_client.get("/api/jobs?limit=10", headers=auth_headers(api_client, "admin", "worker-session")).json()
    ocr_job = next(job for job in jobs if job["jobType"] == "ocr" and job["error"])
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


def test_paddleocr_model_config_prefers_exported_custom_recognition(tmp_path: Path, monkeypatch):
    model_root = tmp_path / "paddle-cola" / "current"
    (model_root / "rec").mkdir(parents=True)
    (model_root / "det").mkdir()
    monkeypatch.setenv("TTB_PADDLEOCR_MODEL_ROOT", str(model_root))
    monkeypatch.setenv("TTB_PADDLEOCR_REQUIRE_CUSTOM", "1")

    config = resolve_model_config()

    assert config.custom is True
    assert config.custom_recognition is True
    assert config.require_custom is True
    assert config.rec_model_dir == str((model_root / "rec").resolve())
    assert config.det_model_dir == str((model_root / "det").resolve())


def test_auto_engine_selection_prefers_real_ocr_over_null_fixture_engine():
    engine = choose_engine([NullOcrEngine(), _FakeOcrEngine("tesseract", "REAL TEXT", estimated_ms=1200)], {"payload": {}})

    assert engine.id == "tesseract"


def test_ocr_task_caches_repeated_field_jobs_for_same_asset(tmp_path: Path):
    image_path = tmp_path / "label.png"
    image_path.write_bytes(PNG_BYTES)
    engine = _FakeOcrEngine("easyocr", "HOLLOW RIDGE 45% ALC/VOL", estimated_ms=1200)
    base_job = {
        "id": "ocr-cache-test",
        "payload": {
            "asset_id": "asset-cache-test",
            "storage_path": str(image_path),
            "field_ocr": True,
        },
    }

    first = process_ocr_job({**base_job, "payload": {**base_job["payload"], "field_key": "brandName"}}, _NoopClient(), [engine], cache_dir=tmp_path / "cache")
    second = process_ocr_job({**base_job, "payload": {**base_job["payload"], "field_key": "alcoholContent"}}, _NoopClient(), [engine], cache_dir=tmp_path / "cache")

    assert engine.calls == 1
    assert first["timings"]["cacheHit"] is False
    assert second["timings"]["cacheHit"] is True
    assert second["fieldKey"] == "alcoholContent"
    assert second["text"] == first["text"]


def test_validation_escalates_hard_fields_to_easyocr_under_latency_budget():
    expected_fields = {
        "brandName": "Hollow Ridge",
        "classType": "Bourbon Whiskey",
        "alcoholContent": "45% alc/vol",
        "netContents": "750 mL",
        "governmentWarningRequired": True,
    }
    job = {
        "id": "validation-easyocr-test",
        "applicationId": "app-worker-escalation",
        "payload": {
            "expected_fields": expected_fields,
            "ocr_strategy": "tesseract_first_easyocr_escalation",
            "primary_engine": "tesseract",
            "fallback_engine": "easyocr",
            "target_latency_ms": 5000,
            "force_escalation": True,
        },
    }
    fallback_text = "\n".join(
        [
            "HOLLOW RIDGE",
            "BOURBON WHISKEY",
            "45% ALC/VOL",
            "750 ML",
            GOVERNMENT_WARNING_TEXT,
        ]
    )

    result = process_validation_job(
        job,
        _NoopClient(),
        [
            _FakeOcrEngine("tesseract", "BLURRY LOW CONFIDENCE TEXT", confidence=0.2, estimated_ms=1200),
            _FakeOcrEngine("easyocr", fallback_text, confidence=0.95, estimated_ms=1800),
        ],
        "worker-easyocr",
    )

    review = result["review_result"]
    assert review["escalation"]["attempted"] is True
    assert review["escalation"]["selected"] in {"easyocr", "primary+easyocr"}
    assert "easyocr" in {engine["engineId"] for engine in review["enginesUsed"]}
    assert review["escalation"]["selectedHardFieldCount"] <= review["escalation"]["primaryHardFieldCount"]


def test_validation_uses_paddleocr_as_authoritative_default():
    expected_fields = {
        "brandName": "Hollow Ridge",
        "classType": "Bourbon Whiskey",
        "alcoholContent": "45% alc/vol",
        "netContents": "750 mL",
        "governmentWarningRequired": True,
    }
    job = {
        "id": "validation-paddle-default-test",
        "applicationId": "app-worker-paddle-default",
        "payload": {"expected_fields": expected_fields},
    }
    paddle_text = "\n".join(
        [
            "HOLLOW RIDGE",
            "BOURBON WHISKEY",
            "45% ALC/VOL",
            "750 ML",
            GOVERNMENT_WARNING_TEXT,
        ]
    )

    result = process_validation_job(
        job,
        _NoopClient(),
        [
            _FakeOcrEngine("paddleocr", paddle_text, confidence=0.95, estimated_ms=900),
            _FakeOcrEngine("easyocr", "unused fallback", confidence=0.95, estimated_ms=1800),
        ],
        "worker-paddle",
    )

    review = result["review_result"]
    assert review["overallStatus"] == "PASS"
    assert review["escalation"]["strategy"] == "paddleocr_authoritative"
    assert review["escalation"]["attempted"] is False
    assert review["enginesUsed"] == [{"engineId": "paddleocr", "displayName": "PaddleOCR COLA", "timingMs": 900}]


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


class _FakeOcrEngine(NullOcrEngine):
    display_name = "Fake OCR"

    def __init__(self, engine_id: str, text: str, *, confidence: float = 0.9, estimated_ms: int = 1000):
        self.id = engine_id
        self.text = text
        self.confidence = confidence
        self.estimated_ms = estimated_ms
        self.calls = 0

    def estimate(self, task: dict, capabilities: dict) -> EngineEstimate:
        return EngineEstimate(self.id, self.estimated_ms, self.confidence, ["fake"])

    def healthcheck(self) -> EngineHealth:
        return EngineHealth(self.id, True, "ok", "fake test engine")

    def recognize(self, image_bytes: bytes, options: dict | None = None):
        self.calls += 1
        return OcrResult(
            engine_id=self.id,
            text=self.text,
            confidence=self.confidence,
            lines=[{"text": self.text, "confidence": self.confidence}],
            elapsed_ms=self.estimated_ms,
        )
