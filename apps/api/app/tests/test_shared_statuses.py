from apps.api.app.core.statuses import canonical_application_status, canonical_review_status


def test_legacy_application_statuses_map_to_canonical_workflow_statuses():
    assert canonical_application_status("created") == "DRAFT"
    assert canonical_application_status("assets_uploaded") == "READY_TO_SUBMIT"
    assert canonical_application_status("review_queued") == "IN_REVIEW"
    assert canonical_application_status("review_completed") == "APPROVED"
    assert canonical_application_status("review_failed") == "REJECTED"


def test_legacy_review_statuses_map_to_canonical_review_statuses():
    assert canonical_review_status("pass") == "PASS"
    assert canonical_review_status("completed") == "PASS"
    assert canonical_review_status("failed") == "FAIL"
    assert canonical_review_status("pass_with_warning") == "PASS_WITH_WARNINGS"
    assert canonical_review_status("queued") == "NEEDS_REVIEW"
