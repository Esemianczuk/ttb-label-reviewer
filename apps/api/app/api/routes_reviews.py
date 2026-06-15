from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..api.deps import get_current_user, get_session_id, require_permission
from ..api.serializers import review_to_read
from ..core.demo_fixtures import ensure_demo_session
from ..db import get_session
from ..schemas import ReviewRead

router = APIRouter(prefix="/api/reviews", tags=["reviews"])


def require_review(session: Session, review_id: str, session_id: str, current_user: models.User | None = None) -> models.Review:
    review = session.get(models.Review, review_id)
    if not review or not review.application:
        raise HTTPException(status_code=404, detail="Review not found.")
    if review.application.session_id != session_id:
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
    return review


@router.get("/{review_id}", response_model=ReviewRead)
def get_review(
    review_id: str,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    return review_to_read(require_review(session, review_id, session_id, current_user))


@router.get("", response_model=list[ReviewRead])
def list_reviews(
    limit: int = 100,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="reviews", action="read")
    ensure_demo_session(session, session_id)
    safe_limit = max(1, min(limit, 250))
    query = (
        select(models.Review)
        .join(models.Application)
        .where(models.Application.session_id == session_id)
        .order_by(models.Review.created_at.desc())
        .limit(safe_limit)
    )
    if current_user.role == "applicant":
        query = query.where(models.Application.owner_user_id == current_user.id)
    reviews = session.scalars(query).all()
    return [review_to_read(review) for review in reviews]
