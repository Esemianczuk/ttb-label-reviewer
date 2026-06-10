from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from .. import models
from ..api.deps import get_session_id
from ..db import get_session

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/{review_id}.json")
def get_review_report_json(review_id: str, session: Session = Depends(get_session), session_id: str = Depends(get_session_id)):
    review = session.get(models.Review, review_id)
    if not review or not review.application or review.application.session_id != session_id:
        raise HTTPException(status_code=404, detail="Review not found.")
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
