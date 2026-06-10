from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..api.deps import get_session_id
from ..api.serializers import review_to_read
from ..db import get_session
from ..schemas import ReviewRead

router = APIRouter(prefix="/api/reviews", tags=["reviews"])


def require_review(session: Session, review_id: str, session_id: str) -> models.Review:
    review = session.get(models.Review, review_id)
    if not review or not review.application or review.application.session_id != session_id:
        raise HTTPException(status_code=404, detail="Review not found.")
    return review


@router.get("/{review_id}", response_model=ReviewRead)
def get_review(review_id: str, session: Session = Depends(get_session), session_id: str = Depends(get_session_id)):
    return review_to_read(require_review(session, review_id, session_id))
