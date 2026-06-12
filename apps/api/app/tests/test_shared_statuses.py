from apps.api.app.core.statuses import canonical_application_status, canonical_review_run_status, canonical_review_status


def test_legacy_application_statuses_map_to_canonical_workflow_statuses():
    assert canonical_application_status("created") == "DRAFT"
    assert canonical_application_status("assets_uploaded") == "READY_TO_SUBMIT"
    assert canonical_application_status("review_queued") == "IN_REVIEW"
    assert canonical_application_status("review_completed") == "IN_REVIEW"
    assert canonical_application_status("review_failed") == "IN_REVIEW"
    assert canonical_application_status("pass") == "READY_TO_SUBMIT"
    assert canonical_application_status("fail") == "APPLICANT_FIX_REQUIRED"


def test_legacy_review_statuses_map_to_canonical_review_statuses():
    assert canonical_review_status("pass") == "PASS"
    assert canonical_review_status("completed") == "NEEDS_REVIEW"
    assert canonical_review_status("failed") == "NEEDS_REVIEW"
    assert canonical_review_status("pass_with_warning") == "PASS_WITH_WARNINGS"
    assert canonical_review_status("queued") == "NEEDS_REVIEW"


def test_review_run_statuses_are_separate_from_compliance_statuses():
    assert canonical_review_run_status("completed") == "COMPLETED"
    assert canonical_review_run_status("processing") == "RUNNING"
    assert canonical_review_run_status("pass") == "QUEUED"
