from __future__ import annotations

from fastapi import APIRouter, Request

from ..schemas import HealthRead

router = APIRouter(tags=["health"])


@router.get("/api/health", response_model=HealthRead)
def health(request: Request):
    settings = request.app.state.settings
    return {
        "ok": True,
        "database": settings.database_url.split("://", 1)[0],
        "assetRoot": str(settings.asset_root),
        "staticDir": str(settings.static_dir),
        "staticReady": (settings.static_dir / "index.html").exists(),
        "lanMode": settings.lan_mode,
        "warning": settings.lan_warning,
    }


@router.get("/api/version")
def version(request: Request):
    settings = request.app.state.settings
    return {"name": settings.app_name, "version": settings.version}
