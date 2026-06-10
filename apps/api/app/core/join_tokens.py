from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from .auth import generate_secret, hash_secret, now_utc, verify_secret


def create_join_token(session: Session, ttl_seconds: int) -> tuple[str, models.WorkerJoinToken]:
    token = generate_secret("ttb_join")
    record = models.WorkerJoinToken(
        token_hash=hash_secret(token),
        expires_at=now_utc() + timedelta(seconds=ttl_seconds),
        created_at=now_utc(),
    )
    session.add(record)
    session.flush()
    return token, record


def consume_join_token(session: Session, token: str | None, worker_id: str) -> bool:
    if not token:
        return False
    now = now_utc()
    for record in session.scalars(select(models.WorkerJoinToken).where(models.WorkerJoinToken.used_at.is_(None))).all():
        if token_expired(record.expires_at, now):
            continue
        if verify_secret(token, record.token_hash):
            record.used_at = now
            record.worker_id = worker_id
            return True
    return False


def token_expired(expires_at, now) -> bool:
    if expires_at.tzinfo is None and now.tzinfo is not None:
        now = now.replace(tzinfo=None)
    if expires_at.tzinfo is not None and now.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=None)
    return expires_at < now
