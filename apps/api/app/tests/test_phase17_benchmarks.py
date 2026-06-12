from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from apps.api.app.config import Settings
from apps.api.app.core.benchmarking import list_benchmark_runs, run_benchmark_suite
from apps.api.app.main import create_app
from apps.api.app.tests.helpers import auth_headers


def test_benchmark_suite_writes_latest_json(tmp_path: Path):
    results_dir = tmp_path / "benchmarks" / "results"

    suite = run_benchmark_suite(results_dir=results_dir, modes=["browser"], counts=[1], label="phase17-test")

    latest = results_dir / "latest.json"
    assert latest.exists()
    parsed = json.loads(latest.read_text(encoding="utf-8"))
    assert parsed["id"] == suite["id"]
    assert parsed["runs"][0]["imageCount"] == 1
    assert parsed["runs"][0]["mode"] == "browser"
    assert parsed["runs"][0]["imagesPerMinute"] > 0
    assert parsed["runs"][0]["engineUsed"]
    assert list_benchmark_runs(results_dir)[0]["id"] == parsed["runs"][0]["id"]


def test_admin_benchmark_api_reads_and_writes_json(tmp_path: Path):
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'api.sqlite3'}",
        data_dir=tmp_path / "data",
        static_dir=tmp_path / "missing-dist",
        benchmark_results_dir=tmp_path / "benchmarks" / "results",
    )
    app = create_app(settings=settings)
    with TestClient(app) as client:
        admin = auth_headers(client, "admin")
        run = client.post(
            "/api/admin/benchmarks/run",
            headers=admin,
            json={"imageCount": 1, "mode": "backend", "label": "phase17-api"},
        )
        assert run.status_code == 200, run.text
        body = run.json()
        assert body[0]["mode"] == "backend"
        assert body[0]["queueMs"] >= 0
        assert body[0]["validationMs"] >= 0
        assert (settings.benchmark_results_dir / "latest.json").exists()

        listed = client.get("/api/admin/benchmarks/results", headers=admin)
        assert listed.status_code == 200, listed.text
        assert listed.json()[0]["id"] == body[0]["id"]


def test_cluster_benchmark_skips_without_workers(tmp_path: Path):
    suite = run_benchmark_suite(results_dir=tmp_path / "results", modes=["cluster"], counts=[10], workers=[], label="cluster-empty")

    run = suite["runs"][0]
    assert run["status"] == "skipped"
    assert run["imageCount"] == 10
    assert run["failures"] == 0
