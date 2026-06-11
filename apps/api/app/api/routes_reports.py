from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from .. import models
from ..api.deps import get_current_user, require_permission
from ..db import get_session

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/{review_id}.json")
def get_review_report_json(
    review_id: str,
    session: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    review = session.get(models.Review, review_id)
    if not review or not review.application:
        raise HTTPException(status_code=404, detail="Review not found.")
    require_permission(
        session,
        current_user,
        resource="reports",
        action="export",
        entity=review,
        entity_id=review_id,
        not_found_for_applicant=True,
    )
    return JSONResponse(
        {
            "reviewId": review.id,
            "applicationId": review.application_id,
            "mode": review.mode,
            "status": review.status,
            "result": review.result_json,
            "createdAt": review.created_at.isoformat(),
            "completedAt": review.completed_at.isoformat() if review.completed_at else None,
        }
    )
