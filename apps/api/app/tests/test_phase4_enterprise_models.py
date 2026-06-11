from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select

from apps.api.app import models
from apps.api.app.api.serializers import (
    application_to_read,
    application_version_to_read,
    audit_event_to_read,
    correction_request_to_read,
    review_decision_to_read,
    setting_to_read,
    user_to_read,
)
from apps.api.app.config import Settings
from apps.api.app.db import init_db, make_session_factory
from apps.api.app.main import create_app
from apps.api.app.tests.helpers import auth_headers


REPO_ROOT = Path(__file__).resolve().parents[4]
ENTERPRISE_TABLES = {
    "users",
    "organizations",
    "application_versions",
    "review_decisions",
    "correction_requests",
    "audit_events",
    "settings",
}


def settings_for(tmp_path: Path, name: str = "api.sqlite3") -> Settings:
    return Settings(
        database_url=f"sqlite:///{tmp_path / name}",
        data_dir=tmp_path / "data",
        static_dir=tmp_path / "missing-dist",
    )


def test_metadata_create_all_includes_enterprise_workflow_tables(tmp_path):
    settings = settings_for(tmp_path, "metadata.sqlite3")
    session_factory = make_session_factory(settings)
    init_db(session_factory)
    inspector = inspect(session_factory.kw["bind"])

    assert ENTERPRISE_TABLES.issubset(set(inspector.get_table_names()))
    assert {"owner_user_id", "organization_id"}.issubset({column["name"] for column in inspector.get_columns("applications")})


def test_enterprise_workflow_models_round_trip(tmp_path):
    settings = settings_for(tmp_path, "roundtrip.sqlite3")
    session_factory = make_session_factory(settings)
    init_db(session_factory)
    db = session_factory()
    try:
        organization = models.Organization(name="Hollow Ridge Distilling", type="producer")
        applicant = models.User(
            email="phase4-applicant@example.local",
            display_name="Applicant",
            role="applicant",
            status="active",
            organization=organization,
        )
        reviewer = models.User(
            email="phase4-reviewer@example.local",
            display_name="Reviewer",
            role="reviewer",
            status="active",
        )
        application = models.Application(
            session_id="session-a",
            owner=applicant,
            organization=organization,
            source="upload",
            status="SUBMITTED",
            expected_fields={"brandName": "Hollow Ridge"},
            metadata_json={"ttbId": "ABC12345678901"},
        )
        application.versions.append(
            models.ApplicationVersion(
                version_number=1,
                expected_fields=application.expected_fields,
                metadata_json=application.metadata_json,
                created_by=applicant,
                submitted_at=models.now_utc(),
            )
        )
        review = models.Review(application=application, mode="backend", status="processing")
        decision = models.ReviewDecision(
            review=review,
            field_key="brandName",
            auto_status="PASS",
            reviewer_status="FAIL",
            effective_status="FAIL",
            reviewer_note="Manual correction needed.",
            reviewer=reviewer,
        )
        correction = models.CorrectionRequest(
            application=application,
            review=review,
            requested_by=reviewer,
            status="open",
            message="Please correct the brand evidence.",
            field_keys=["brandName"],
        )
        audit_event = models.AuditEvent(
            actor=reviewer,
            actor_role="reviewer",
            event_type="review.decision_override",
            entity_type="review_decision",
            entity_id="brandName",
            summary="Reviewer overrode brandName.",
            before_json={"effectiveStatus": "PASS"},
            after_json={"effectiveStatus": "FAIL"},
            metadata_json={"applicationId": application.id},
        )
        setting = models.Setting(key="retention", value_json={"days": 30})
        db.add_all([organization, applicant, reviewer, application, review, decision, correction, audit_event, setting])
        db.commit()

        stored_application = db.scalar(select(models.Application).where(models.Application.id == application.id))
        assert stored_application is not None
        assert stored_application.owner.email == "phase4-applicant@example.local"
        assert stored_application.organization.name == "Hollow Ridge Distilling"
        assert stored_application.versions[0].version_number == 1
        assert stored_application.reviews[0].decisions[0].effective_status == "FAIL"
        assert stored_application.reviews[0].correction_requests[0].field_keys == ["brandName"]

        assert user_to_read(applicant)["organizationId"] == organization.id
        assert application_to_read(stored_application)["versionCount"] == 1
        assert application_version_to_read(stored_application.versions[0])["createdByUserId"] == applicant.id
        assert review_decision_to_read(decision)["reviewerUserId"] == reviewer.id
        assert correction_request_to_read(correction)["fieldKeys"] == ["brandName"]
        assert audit_event_to_read(audit_event)["after"] == {"effectiveStatus": "FAIL"}
        assert setting_to_read(setting)["value"] == {"days": 30}
    finally:
        db.close()


def test_application_create_writes_initial_version(tmp_path):
    app = create_app(settings=settings_for(tmp_path, "api.sqlite3"))
    with TestClient(app) as client:
        response = client.post(
            "/api/applications",
            headers=auth_headers(client, "applicant", "session-a"),
            json={
                "source": "upload",
                "expectedFields": {
                    "productType": "distilled_spirits",
                    "brandName": "Hollow Ridge",
                    "classType": "Bourbon Whiskey",
                    "alcoholContent": "45% alc/vol",
                    "netContents": "750 mL",
                    "governmentWarningRequired": True,
                },
                "metadata": {"ttbId": "ABC12345678901"},
            },
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["versionCount"] == 1
        assert body["currentVersionNumber"] == 1

        session_factory = app.state.session_factory
        with session_factory() as db:
            versions = db.scalars(select(models.ApplicationVersion).where(models.ApplicationVersion.application_id == body["id"])).all()
            assert len(versions) == 1
            assert versions[0].expected_fields["brandName"] == "Hollow Ridge"
            assert versions[0].metadata_json["ttbId"] == "ABC12345678901"


def test_alembic_head_creates_enterprise_tables(tmp_path, monkeypatch):
    monkeypatch.setenv("TTB_API_DATABASE_URL", f"sqlite:///{tmp_path / 'migrated.sqlite3'}")
    monkeypatch.setenv("TTB_API_DATA_DIR", str(tmp_path / "data"))
    config = Config(str(REPO_ROOT / "apps/api/alembic.ini"))

    command.upgrade(config, "head")

    inspector = inspect(make_session_factory(settings_for(tmp_path, "migrated.sqlite3")).kw["bind"])
    table_names = set(inspector.get_table_names())
    assert ENTERPRISE_TABLES.issubset(table_names)
    assert {"owner_user_id", "organization_id"}.issubset({column["name"] for column in inspector.get_columns("applications")})
