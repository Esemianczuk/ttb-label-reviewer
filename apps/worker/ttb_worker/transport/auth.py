from __future__ import annotations


def auth_headers(token: str | None = None) -> dict[str, str]:
    if not token:
        return {}
    return {"Authorization": f"Bearer {token}"}
