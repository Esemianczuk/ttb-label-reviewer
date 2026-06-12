from __future__ import annotations

import base64

from fastapi.testclient import TestClient

PNG_1X1_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def auth_headers(client: TestClient, role: str = "applicant", session_id: str = "session-a") -> dict[str, str]:
    login = client.post("/api/auth/demo-login", json={"role": role})
    assert login.status_code == 200, login.text
    token = login.json()["token"]
    return {"Authorization": f"Bearer {token}", "X-Session-Id": session_id}


def bearer_headers(client: TestClient, role: str = "applicant") -> dict[str, str]:
    login = client.post("/api/auth/demo-login", json={"role": role})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['token']}"}
