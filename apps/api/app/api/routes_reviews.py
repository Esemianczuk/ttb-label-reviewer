from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..api.deps import get_current_user, get_session_id, require_permission
from ..api.serializers import review_to_read
from ..db import get_session
from ..schemas import ReviewRead

router = APIRouter(prefix="/api/reviews", tags=["reviews"])


def require_review(session: Session, review_id: str, session_id: str, current_user: models.User | None = None) -> models.Review:
    review = session.get(models.Review, review_id)
    if not review or not review.application:
        raise HTTPException(status_code=404, detail="Review not found.")
    if current_user:
        require_permission(
            session,
            current_user,
            resource="reviews",
            action="read",
            entity=review,
            entity_id=review_id,
            not_found_for_applicant=True,
        )
    elif review.application.session_id != session_id:
        raise HTTPException(status_code=404, detail="Review not found.")
    return review


@router.get("/{review_id}", response_model=ReviewRead)
def get_review(
    review_id: str,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    return review_to_read(require_review(session, review_id, session_id, current_user))
