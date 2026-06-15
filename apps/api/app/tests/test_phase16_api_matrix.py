from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select

from apps.api.app import models
from apps.api.app.config import Settings
from apps.api.app.main import create_app
from apps.api.app.tests.helpers import auth_headers


def make_client(tmp_path):
    app = create_app(
        settings=Settings(
            database_url=f"sqlite:///{tmp_path / 'phase16-api.sqlite3'}",
            data_dir=tmp_path / "data",
            static_dir=tmp_path / "missing-dist",
        )
    )
    return app, TestClient(app)


def application_payload(name: str) -> dict:
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
        "metadata": {"notes": "phase 16 API matrix"},
    }


def create_application(client: TestClient, name: str) -> dict:
    response = client.post("/api/applications", json=application_payload(name), headers=auth_headers(client, "admin", "phase16-api"))
    assert response.status_code == 201, response.text
    return response.json()


def seed_review_with_decision(db, application_id: str, *, field_key: str = "brandName") -> tuple[models.Review, models.ReviewDecision]:
    review = models.Review(
        application_id=application_id,
        mode="backend",
        status="fail",
        result_json={
            "overallStatus": "FAIL",
            "fields": [{"fieldKey": field_key, "status": "FAIL", "reason": "Seeded API matrix decision."}],
        },
    )
    db.add(review)
    db.flush()
    decision = models.ReviewDecision(
        review_id=review.id,
        field_key=field_key,
        auto_status="FAIL",
        reviewer_status="PASS",
        effective_status="PASS",
        reviewer_note="Reviewer accepted alternate evidence.",
    )
    db.add(decision)
    db.commit()
    return review, decision


def test_report_export_and_enterprise_records_cover_reviews_decisions_and_corrections(tmp_path):
    app, client = make_client(tmp_path)
    with client:
        application = create_application(client, "Matrix Label")
        with app.state.session_factory() as db:
            review, decision = seed_review_with_decision(db, application["id"])
            correction = models.CorrectionRequest(
                application_id=application["id"],
                review_id=review.id,
                status="open",
                message="Clarify the brand statement.",
                field_keys=["brandName"],
            )
            db.add(correction)
            db.commit()
            correction_id = correction.id

        report = client.get(f"/api/reports/{review.id}.json", headers=auth_headers(client, "reviewer", "phase16-api"))
        assert report.status_code == 200, report.text
        assert report.json()["result"]["fields"][0]["fieldKey"] == "brandName"

    with app.state.session_factory() as db:
        stored_decision = db.get(models.ReviewDecision, decision.id)
        stored_correction = db.get(models.CorrectionRequest, correction_id)
        assert stored_decision is not None
        assert stored_decision.effective_status == "PASS"
        assert stored_correction is not None
        assert stored_correction.field_keys == ["brandName"]


def test_delete_application_packet_preserves_unrelated_review_decisions(tmp_path):
    app, client = make_client(tmp_path)
    with client:
        first = create_application(client, "First Matrix")
        second = create_application(client, "Second Matrix")
        with app.state.session_factory() as db:
            _, first_decision = seed_review_with_decision(db, first["id"], field_key="brandName")
            _, second_decision = seed_review_with_decision(db, second["id"], field_key="classType")

        deleted = client.post(f"/api/admin/retention/delete-application/{first['id']}", headers=auth_headers(client, "admin", "phase16-api"))
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()["count"] == 1

    with app.state.session_factory() as db:
        assert db.get(models.Application, first["id"]) is None
        assert db.get(models.ReviewDecision, first_decision.id) is None
        assert db.get(models.Application, second["id"]) is not None
        assert db.get(models.ReviewDecision, second_decision.id) is not None


def test_purge_all_demo_data_removes_decisions_corrections_and_audits(tmp_path):
    app, client = make_client(tmp_path)
    with client:
        application = create_application(client, "Purge Matrix")
        with app.state.session_factory() as db:
            review, _ = seed_review_with_decision(db, application["id"])
            db.add(
                models.CorrectionRequest(
                    application_id=application["id"],
                    review_id=review.id,
                    status="open",
                    message="Fix label evidence.",
                    field_keys=["brandName"],
                )
            )
            db.commit()

        purged = client.post("/api/admin/retention/purge-all-demo-data", headers=auth_headers(client, "admin", "phase16-api"))
        assert purged.status_code == 200, purged.text
        assert purged.json()["count"] >= 4

    with app.state.session_factory() as db:
        assert db.scalar(select(models.Application)) is None
        assert db.scalar(select(models.Review)) is None
        assert db.scalar(select(models.ReviewDecision)) is None
        assert db.scalar(select(models.CorrectionRequest)) is None
        audit = db.scalars(select(models.AuditEvent)).all()
        assert any(event.event_type == "retention.purge_all_demo_data" for event in audit)
