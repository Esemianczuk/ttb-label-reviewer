from __future__ import annotations

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import sessionmaker

from .api import routes_applications, routes_assets, routes_health, routes_jobs, routes_reports, routes_reviews, routes_workers, ws_progress
from .config import Settings, get_settings
from .db import init_db, make_session_factory


def create_app(settings: Settings | None = None, session_factory: sessionmaker | None = None, init_database: bool = True) -> FastAPI:
    settings = settings or get_settings()
    session_factory = session_factory or make_session_factory(settings)
    if init_database:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        settings.asset_root.mkdir(parents=True, exist_ok=True)
        init_db(session_factory)

    app = FastAPI(title=settings.app_name, version=settings.version)
    app.state.settings = settings
    app.state.session_factory = session_factory

    from . import db

    def override_get_session():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[db.get_session] = override_get_session

    app.include_router(routes_health.router)
    app.include_router(routes_applications.router)
    app.include_router(routes_jobs.router)
    app.include_router(routes_reviews.router)
    app.include_router(routes_workers.router)
    app.include_router(routes_assets.router)
    app.include_router(routes_reports.router)
    app.include_router(ws_progress.router)

    if settings.static_dir.exists() and (settings.static_dir / "index.html").exists():
        app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="frontend")

    return app


app = create_app()


def main() -> None:
    uvicorn.run("apps.api.app.main:app", host="127.0.0.1", port=8000, reload=False)


if __name__ == "__main__":
    main()
