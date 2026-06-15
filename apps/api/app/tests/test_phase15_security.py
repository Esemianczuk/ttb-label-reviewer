from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from apps.api.app import models
from apps.api.app.config import Settings
from apps.api.app.main import create_app
from apps.api.app.tests.helpers import PNG_1X1_BYTES, auth_headers


def app_payload(name: str = "Hardened Label") -> dict:
    return {
        "source": "upload",
        "expectedFields": {
            "productType": "distilled_spirits",
            "brandName": name,
            "classType": "Bourbon Whiskey",
            "alcoholContent": "45% alc/vol",
            "netContents": "750 mL",
            "governmentWarningRequired": True,
        },
        "metadata": {"notes": "phase 15 security test"},
    }


def make_client(tmp_path: Path, **settings_overrides):
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'security.sqlite3'}",
        data_dir=tmp_path / "data",
        static_dir=tmp_path / "missing-dist",
        **settings_overrides,
    )
    app = create_app(settings=settings)
    return app, TestClient(app)


def create_application(client: TestClient, role: str = "applicant", session_id: str = "security-session") -> dict:
    response = client.post("/api/applications", headers=auth_headers(client, role, session_id), json=app_payload())
    assert response.status_code == 201, response.text
    return response.json()


def upload_image(client: TestClient, application_id: str, *, filename: str = "front.png", content_type: str = "image/png", data: bytes = PNG_1X1_BYTES):
    return client.post(
        f"/api/applications/{application_id}/images",
        headers=auth_headers(client, "applicant", "security-session"),
        data={"role": "front"},
        files={"file": (filename, data, content_type)},
    )


def issue_join_token(client: TestClient) -> str:
    response = client.post("/api/workers/join-token", headers=auth_headers(client, "admin"), json={"ttlSeconds": 300})
    assert response.status_code == 201, response.text
    return response.json()["token"]


def register_worker(client: TestClient, worker_id: str = "phase15-worker") -> dict:
    response = client.post(
        "/api/workers/register",
        json={
            "id": worker_id,
            "hostname": "phase15-host",
            "platform": "linux",
            "arch": "x86_64",
            "version": "test",
            "joinToken": issue_join_token(client),
            "maxConcurrency": 1,
            "capabilities": {"ocr": True, "validation": True, "supportedJobTypes": ["ocr", "validation"]},
            "calibration": {"engines": {"null": {"steadyStateMs": 1}}},
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def worker_headers(secret: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}"}


def test_cors_defaults_to_localhost_dev_origins_and_rejects_unknown_origin(tmp_path):
    _, client = make_client(tmp_path)
    with client:
        allowed = client.options(
            "/api/health",
            headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
        )
        assert allowed.status_code == 200
        assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"

        denied = client.options(
            "/api/health",
            headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
        )
        assert denied.status_code == 400
        assert "access-control-allow-origin" not in denied.headers


def test_lan_mode_health_warning_is_prominent(tmp_path):
    _, client = make_client(tmp_path, host="0.0.0.0")
    with client:
        health = client.get("/api/health").json()
        assert health["lanMode"] is True
        assert "LAN MODE ENABLED" in health["warning"]
        assert "trusted network" in health["warning"]


def test_upload_normalizes_extension_and_blocks_path_traversal_reads(tmp_path):
    app, client = make_client(tmp_path)
    with client:
        application = create_application(client)
        uploaded = upload_image(client, application["id"], filename="../../evil.php", content_type="image/png")
        assert uploaded.status_code == 201, uploaded.text
        asset = uploaded.json()
        assert asset["originalFilename"] == "evil.php"
        assert asset["mimeType"] == "image/png"
        assert asset["width"] == 1
        assert asset["height"] == 1

        with app.state.session_factory() as db:
            record = db.get(models.Asset, asset["id"])
            assert record is not None
            storage_path = Path(record.storage_path)
            storage_path.resolve().relative_to(app.state.settings.asset_root.resolve())
            assert storage_path.suffix == ".png"
            record.storage_path = str(tmp_path.parent / "outside.png")
            db.commit()

        blocked = client.get(f"/api/assets/{asset['id']}/content", headers=auth_headers(client, "applicant", "security-session"))
        assert blocked.status_code == 404


@pytest.mark.parametrize(
    ("filename", "content_type", "data"),
    [
        ("spoof.png", "image/png", b"%PDF-1.7\nnot an image"),
        ("front.png", "text/plain", PNG_1X1_BYTES),
        ("front.jpg", "image/png", PNG_1X1_BYTES),
    ],
)
def test_upload_rejects_mime_spoofing_and_extension_mismatch(tmp_path, filename, content_type, data):
    _, client = make_client(tmp_path)
    with client:
        application = create_application(client)
        response = upload_image(client, application["id"], filename=filename, content_type=content_type, data=data)
        assert response.status_code == 400


def test_unauthorized_access_is_denied_and_applicant_cross_read_is_audited(tmp_path):
    app, client = make_client(tmp_path)
    with client:
        assert client.get("/api/applications").status_code == 401
        admin_app = create_application(client, role="admin", session_id="admin-session")
        cross_read = client.get(f"/api/applications/{admin_app['id']}", headers=auth_headers(client, "applicant", "security-session"))
        assert cross_read.status_code == 404

    with app.state.session_factory() as db:
        denied = db.scalars(
            select(models.AuditEvent).where(
                models.AuditEvent.event_type == "authz.denied",
                models.AuditEvent.entity_type == "applications",
                models.AuditEvent.entity_id == admin_app["id"],
            )
        ).all()
        assert denied
        assert denied[-1].actor_role == "applicant"


def test_worker_claim_requires_authentication(tmp_path):
    app, client = make_client(tmp_path)
    with client:
        worker = register_worker(client)
        unauthenticated = client.post(f"/api/workers/{worker['id']}/claim", json={"supportedJobTypes": ["ocr"]})
        assert unauthenticated.status_code == 401

        wrong_secret = client.post(
            f"/api/workers/{worker['id']}/claim",
            headers=worker_headers("ttb_worker_wrong"),
            json={"supportedJobTypes": ["ocr"]},
        )
        assert wrong_secret.status_code == 401

    with app.state.session_factory() as db:
        denied = db.scalars(select(models.AuditEvent).where(models.AuditEvent.entity_id == worker["id"])).all()
        assert any(event.event_type == "authz.denied" for event in denied)


def test_stale_worker_must_heartbeat_before_claiming_jobs(tmp_path):
    app, client = make_client(tmp_path, worker_stale_seconds=1)
    with client:
        worker = register_worker(client)
        secret = worker["workerSecret"]
        assert secret

        with app.state.session_factory() as db:
            record = db.get(models.Worker, worker["id"])
            assert record is not None
            record.last_seen_at = models.now_utc() - timedelta(seconds=30)
            record.status = "online"
            db.commit()

        stale_claim = client.post(f"/api/workers/{worker['id']}/claim", headers=worker_headers(secret), json={"supportedJobTypes": ["ocr"]})
        assert stale_claim.status_code == 409
        assert "heartbeat is stale" in stale_claim.json()["detail"]

        heartbeat = client.post(
            f"/api/workers/{worker['id']}/heartbeat",
            headers=worker_headers(secret),
            json={"activeJobs": 0, "status": "online"},
        )
        assert heartbeat.status_code == 200
        fresh_claim = client.post(f"/api/workers/{worker['id']}/claim", headers=worker_headers(secret), json={"supportedJobTypes": ["ocr"]})
        assert fresh_claim.status_code == 200


def test_admin_can_purge_all_demo_data_and_raw_assets(tmp_path):
    app, client = make_client(tmp_path)
    with client:
        application = create_application(client)
        uploaded = upload_image(client, application["id"])
        assert uploaded.status_code == 201, uploaded.text
        asset_id = uploaded.json()["id"]

        with app.state.session_factory() as db:
            asset = db.get(models.Asset, asset_id)
            assert asset is not None
            assert Path(asset.storage_path).exists()

        denied = client.post("/api/admin/retention/purge-all-demo-data", headers=auth_headers(client, "reviewer"))
        assert denied.status_code == 403

        admin_headers = auth_headers(client, "admin", "security-session")
        purged = client.post("/api/admin/retention/purge-all-demo-data", headers=admin_headers)
        assert purged.status_code == 200, purged.text
        assert purged.json()["count"] >= 2
        assert client.get("/api/applications", headers=admin_headers).json() == []

    with app.state.session_factory() as db:
        assert db.scalar(select(models.Application)) is None
        assert db.scalar(select(models.Asset)) is None
        events = db.scalars(select(models.AuditEvent)).all()
        assert any(event.event_type == "retention.purge_all_demo_data" for event in events)
