from __future__ import annotations

from typing import Any

import httpx


class CoordinatorError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None, payload: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


class CoordinatorClient:
    def __init__(
        self,
        base_url: str,
        *,
        session_id: str | None = None,
        join_token: str | None = None,
        worker_secret: str | None = None,
        timeout: float = 30.0,
        http_client: Any | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.session_id = session_id
        self.join_token = join_token
        self.worker_secret = worker_secret
        self._owns_client = http_client is None
        self.client = http_client or httpx.Client(base_url=self.base_url, timeout=timeout)

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def health(self) -> dict[str, Any]:
        return self._request("GET", "/api/health").json()

    def register_worker(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self._request("POST", "/api/workers/register", json=payload).json()
        if response.get("workerSecret"):
            self.worker_secret = response["workerSecret"]
        return response

    def heartbeat(self, worker_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/workers/{worker_id}/heartbeat", json=payload).json()

    def claim_job(self, worker_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/workers/{worker_id}/claim", json=payload).json()

    def complete_job(self, worker_id: str, job_id: str, result: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/workers/{worker_id}/complete", json={"jobId": job_id, "result": result}).json()

    def fail_job(self, worker_id: str, job_id: str, error: str, retryable: bool = True) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/workers/{worker_id}/fail",
            json={"jobId": job_id, "error": error, "retryable": retryable},
        ).json()

    def get_asset_content(self, asset_id: str, session_id: str | None = None) -> bytes:
        return self._request("GET", f"/api/assets/{asset_id}/content", session_id=session_id).content

    def _request(self, method: str, path: str, *, json: dict[str, Any] | None = None, session_id: str | None = None):
        headers = self._headers(session_id)
        try:
            response = self.client.request(method, path, headers=headers, json=json)
        except TypeError:
            request_method = getattr(self.client, method.lower())
            response = request_method(path, headers=headers, json=json)
        if response.status_code >= 400:
            payload = _safe_json(response)
            raise CoordinatorError(f"Coordinator returned HTTP {response.status_code}: {payload}", response.status_code, payload)
        return response

    def _headers(self, session_id: str | None = None) -> dict[str, str]:
        effective_session_id = session_id or self.session_id
        headers = {"X-Session-Id": effective_session_id} if effective_session_id else {}
        if self.worker_secret:
            headers["Authorization"] = f"Bearer {self.worker_secret}"
        if self.join_token:
            headers["X-Join-Token"] = self.join_token
        return headers


def _safe_json(response) -> Any:
    try:
        return response.json()
    except Exception:
        return getattr(response, "text", "")
