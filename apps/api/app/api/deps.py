from __future__ import annotations

from fastapi import Header


def get_session_id(x_session_id: str | None = Header(default=None, alias="X-Session-Id")) -> str:
    return x_session_id or "local-dev-session"

