from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select

from apps.api.app import models
from apps.api.app.config import Settings
from apps.api.app.main import create_app
from apps.api.app.tests.helpers import auth_headers, bearer_headers


def app_payload(name: str = "Hollow Ridge") -> dict:
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
        "metadata": {"notes": "phase 5 auth test"},
    }


def make_client(tmp_path):
    app = create_app(
        settings=Settings(
            database_url=f"sqlite:///{tmp_path / 'auth.sqlite3'}",
            data_dir=tmp_path / "data",
            static_dir=tmp_path / "missing-dist",
        )
    )
    return app, TestClient(app)


def test_demo_login_me_logout_and_authz_can(tmp_path):
    app, client = make_client(tmp_path)
    with client:
        login = client.post("/api/auth/demo-login", json={"role": "reviewer"})
        assert login.status_code == 200, login.text
        token = login.json()["token"]
        assert token.startswith("ttb_demo_")
        auth = {"Authorization": f"Bearer {token}"}
        assert client.get("/api/auth/me", headers=auth).json()["email"] == "reviewer@example.local"

        denied = client.post("/api/authz/can", headers=auth, json={"resource": "workers", "action": "manage"}).json()
        assert denied == {"can": False, "reason": "Reviewers cannot manage workers."}

        allowed = client.post("/api/authz/can", headers=bearer_headers(client, "admin"), json={"resource": "workers", "action": "manage"}).json()
        assert allowed == {"can": True, "reason": None}
        assert client.post("/api/auth/logout", headers=auth).json() == {"ok": True}

    with app.state.session_factory() as db:
        event_types = {event.event_type for event in db.scalars(select(models.AuditEvent)).all()}
        assert {"auth.demo_login", "auth.logout", "authz.checked"}.issubset(event_types)


def test_applicant_cannot_cross_read_or_approve_and_denial_is_audited(tmp_path):
    app, client = make_client(tmp_path)
    with app.state.session_factory() as db:
        other_applicant = models.User(
            id="00000000-0000-0000-0000-000000000099",
            email="other-applicant@example.local",
            display_name="Other Applicant",
            role="applicant",
            status="active",
            organization_id="00000000-0000-0000-0000-000000000100",
        )
        other_application = models.Application(
            id="00000000-0000-0000-0000-000000000199",
            session_id="other-applicant-session",
            source="upload",
            status="assets_uploaded",
            owner_user_id=other_applicant.id,
            organization_id=other_applicant.organization_id,
            expected_fields=app_payload("Other Label")["expectedFields"],
            metadata_json={"notes": "belongs to another applicant"},
        )
        db.add_all([other_applicant, other_application])
        db.commit()

    with client:
        admin_app = client.post("/api/applications", headers=auth_headers(client, "admin", "admin-session"), json=app_payload("Admin Label")).json()

        cross_read = client.get(f"/api/applications/{admin_app['id']}", headers=auth_headers(client, "applicant", "applicant-session"))
        assert cross_read.status_code == 404
        other_applicant_read = client.get(
            "/api/applications/00000000-0000-0000-0000-000000000199",
            headers=auth_headers(client, "applicant", "applicant-session"),
        )
        assert other_applicant_read.status_code == 404

        approve = client.post("/api/authz/can", headers=bearer_headers(client, "applicant"), json={"resource": "reviews", "action": "approve"})
        assert approve.json()["can"] is False
        assert "Applicants cannot approve reviews" in approve.json()["reason"]

    with app.state.session_factory() as db:
        denied_events = db.scalars(select(models.AuditEvent).where(models.AuditEvent.event_type == "authz.denied")).all()
        assert denied_events
        assert denied_events[-1].actor_role == "applicant"


def test_reviewer_cannot_manage_workers_admin_can_and_worker_token_cannot_use_human_endpoints(tmp_path):
    app, client = make_client(tmp_path)
    with client:
        assert client.get("/api/workers", headers=auth_headers(client, "reviewer")).status_code == 403
        assert client.get("/api/workers", headers=auth_headers(client, "admin")).status_code == 200

        join_token = client.post("/api/cluster/join-token", headers=auth_headers(client, "admin"), json={"ttlSeconds": 300}).json()["token"]
        registered = client.post(
            "/api/workers/register",
            json={
                "id": "rbac-worker",
                "hostname": "rbac-host",
                "platform": "linux",
                "arch": "x86_64",
                "version": "test",
                "joinToken": join_token,
                "maxConcurrency": 1,
                "capabilities": {"ocr": True, "supportedJobTypes": ["ocr"]},
                "calibration": {"engines": {"null": {"steadyStateMs": 1}}},
            },
        )
        assert registered.status_code == 201, registered.text
        worker_secret = registered.json()["workerSecret"]
        assert worker_secret

        human_endpoint = client.get("/api/applications", headers={"Authorization": f"Bearer {worker_secret}"})
        assert human_endpoint.status_code == 401

        heartbeat = client.post(
            "/api/workers/rbac-worker/heartbeat",
            headers={"Authorization": f"Bearer {worker_secret}"},
            json={"activeJobs": 0, "status": "online"},
        )
        assert heartbeat.status_code == 200
