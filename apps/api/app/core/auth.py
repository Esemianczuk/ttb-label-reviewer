from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timezone


def generate_secret(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(32)}"


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def verify_secret(secret: str | None, expected_hash: str | None) -> bool:
    if not secret or not expected_hash:
        return False
    return hmac.compare_digest(hash_secret(secret), expected_hash)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
