from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any


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


def issue_signed_token(payload: dict[str, Any], *, secret: str, ttl_seconds: int, prefix: str = "ttb_demo") -> tuple[str, datetime]:
    expires_at = now_utc() + timedelta(seconds=ttl_seconds)
    signed_payload = {
        **payload,
        "exp": expires_at.isoformat().replace("+00:00", "Z"),
    }
    body = _base64url_encode(json.dumps(signed_payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = _signature(body, secret)
    return f"{prefix}_{body}.{signature}", expires_at


def verify_signed_token(token: str | None, *, secret: str, prefix: str = "ttb_demo") -> dict[str, Any] | None:
    if not token or not token.startswith(f"{prefix}_"):
        return None
    raw = token[len(prefix) + 1 :]
    body, separator, signature = raw.partition(".")
    if not separator or not body or not signature:
        return None
    expected_signature = _signature(body, secret)
    if not hmac.compare_digest(signature, expected_signature):
        return None
    try:
        payload = json.loads(_base64url_decode(body))
    except Exception:
        return None
    expires_at = _parse_expiry(payload.get("exp"))
    if not expires_at or expires_at < now_utc():
        return None
    return payload


def _signature(body: str, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    return _base64url_encode(digest)


def _base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _base64url_decode(value: str) -> str:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii")).decode("utf-8")


def _parse_expiry(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
