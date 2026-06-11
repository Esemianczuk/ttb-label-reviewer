from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select

from apps.api.app import models
from apps.api.app.config import Settings
from apps.api.app.main import create_app
from apps.api.app.tests.helpers import auth_headers


PNG_BYTES = b"\x89PNG\r\n\x1a\nphase-6-workflow"


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
        "metadata": {"notes": "phase 6 workflow test"},
    }


def make_client(tmp_path):
    app = create_app(
        settings=Settings(
            database_url=f"sqlite:///{tmp_path / 'workflow.sqlite3'}",
            data_dir=tmp_path / "data",
            static_dir=tmp_path / "missing-dist",
        )
    )
    return app, TestClient(app)


def create_application(client: TestClient, session_id: str = "workflow-session") -> dict:
    response = client.post("/api/applications", headers=auth_headers(client, "applicant", session_id), json=app_payload())
    assert response.status_code == 201, response.text
    return response.json()


def upload_image(client: TestClient, application_id: str, session_id: str = "workflow-session") -> dict:
    response = client.post(
        f"/api/applications/{application_id}/images",
        headers=auth_headers(client, "applicant", session_id),
        data={"role": "front"},
        files={"file": ("front.png", PNG_BYTES, "image/png")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def transition(client: TestClient, application_id: str, role: str, payload: dict, session_id: str = "workflow-session"):
    return client.post(
        f"/api/applications/{application_id}/transition",
        headers=auth_headers(client, role, session_id),
        json=payload,
    )


def test_application_workflow_happy_path_and_guard_failures(tmp_path):
    app, client = make_client(tmp_path)
    with client:
        application = create_application(client)
        assert application["status"] == "DRAFT"

        blocked = transition(client, application["id"], "applicant", {"transition": "submit"})
        assert blocked.status_code == 400
        assert "Allowed from" in blocked.json()["detail"]

        no_image_precheck = transition(client, application["id"], "applicant", {"transition": "run_precheck"})
        assert no_image_precheck.status_code == 400
        assert "uploaded image" in no_image_precheck.json()["detail"]

        upload_image(client, application["id"])
        assert transition(client, application["id"], "applicant", {"transition": "run_precheck"}).json()["status"] == "PRECHECK_RUNNING"
        failed_precheck_missing_context = transition(client, application["id"], "applicant", {"transition": "precheck_fail"})
        assert failed_precheck_missing_context.status_code == 400
        assert "fieldKeys or a note" in failed_precheck_missing_context.json()["detail"]
        assert transition(client, application["id"], "applicant", {"transition": "precheck_pass"}).json()["status"] == "READY_TO_SUBMIT"
        assert transition(client, application["id"], "applicant", {"transition": "submit", "note": "Ready for label review."}).json()["status"] == "SUBMITTED"

        applicant_review = transition(client, application["id"], "applicant", {"transition": "start_review"})
        assert applicant_review.status_code == 403
        assert transition(client, application["id"], "reviewer", {"transition": "start_review"}).json()["status"] == "IN_REVIEW"

        correction_without_note = transition(client, application["id"], "reviewer", {"transition": "request_correction", "fieldKeys": ["brandName"]})
        assert correction_without_note.status_code == 400
        assert "requires a note" in correction_without_note.json()["detail"]
        assert (
            transition(
                client,
                application["id"],
                "reviewer",
                {"transition": "request_correction", "note": "Clarify the brand statement.", "fieldKeys": ["brandName"]},
            ).json()["status"]
            == "NEEDS_CORRECTION"
        )

        resubmit_without_change = transition(client, application["id"], "applicant", {"transition": "resubmit"})
        assert resubmit_without_change.status_code == 400
        assert "Resubmission requires" in resubmit_without_change.json()["detail"]
        resubmitted = transition(
            client,
            application["id"],
            "applicant",
            {
                "transition": "resubmit",
                "expectedFields": {
                    **app_payload("Hollow Ridge Updated")["expectedFields"],
                    "producerName": "Hollow Ridge Distilling",
                },
                "note": "Updated the applicant packet.",
            },
        ).json()
        assert resubmitted["status"] == "RESUBMITTED"
        assert resubmitted["versionCount"] == 2
        assert transition(client, application["id"], "reviewer", {"transition": "start_review"}).json()["status"] == "IN_REVIEW"

        reject_without_reason = transition(client, application["id"], "reviewer", {"transition": "reject"})
        assert reject_without_reason.status_code == 400
        assert "requires a reason" in reject_without_reason.json()["detail"]
        assert transition(client, application["id"], "reviewer", {"transition": "reject", "note": "Critical label mismatch remains."}).json()["status"] == "REJECTED"

        reviewer_archive = transition(client, application["id"], "reviewer", {"transition": "archive"})
        assert reviewer_archive.status_code == 403
        assert "Only admins" in reviewer_archive.json()["detail"]
        assert transition(client, application["id"], "admin", {"transition": "archive"}).json()["status"] == "ARCHIVED"

    with app.state.session_factory() as db:
        corrections = db.scalars(select(models.CorrectionRequest).where(models.CorrectionRequest.application_id == application["id"])).all()
        assert len(corrections) == 1
        assert corrections[0].status == "resolved"
        events = db.scalars(select(models.AuditEvent).where(models.AuditEvent.entity_id == application["id"])).all()
        assert any(event.event_type == "application.transition" for event in events)
        assert any(event.event_type == "authz.denied" for event in events)


def test_approval_requires_override_for_unresolved_critical_failures(tmp_path):
    app, client = make_client(tmp_path)
    with client:
        application = create_application(client)
        upload_image(client, application["id"])
        assert transition(client, application["id"], "applicant", {"transition": "run_precheck"}).json()["status"] == "PRECHECK_RUNNING"
        assert transition(client, application["id"], "applicant", {"transition": "precheck_pass"}).json()["status"] == "READY_TO_SUBMIT"
        assert transition(client, application["id"], "applicant", {"transition": "submit"}).json()["status"] == "SUBMITTED"
        assert transition(client, application["id"], "reviewer", {"transition": "start_review"}).json()["status"] == "IN_REVIEW"

        with app.state.session_factory() as db:
            review = models.Review(
                application_id=application["id"],
                mode="backend",
                status="fail",
                result_json={
                    "overallStatus": "FAIL",
                    "fields": [
                        {
                            "fieldKey": "brandName",
                            "field": "Brand Name",
                            "status": "FAIL",
                            "severity": "critical",
                            "reason": "Brand text does not match the application.",
                        }
                    ],
                },
            )
            db.add(review)
            db.commit()

        blocked = transition(client, application["id"], "reviewer", {"transition": "approve"})
        assert blocked.status_code == 400
        assert "unresolved critical failures" in blocked.json()["detail"]

        missing_note = transition(client, application["id"], "reviewer", {"transition": "approve", "reviewerOverride": True})
        assert missing_note.status_code == 400
        assert "override note" in missing_note.json()["detail"]

        approved = transition(
            client,
            application["id"],
            "reviewer",
            {"transition": "approve", "reviewerOverride": True, "note": "Senior reviewer accepts documented evidence."},
        )
        assert approved.status_code == 200, approved.text
        assert approved.json()["status"] == "APPROVED"
