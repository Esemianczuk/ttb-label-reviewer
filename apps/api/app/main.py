from __future__ import annotations

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import sessionmaker

from .api import (
    routes_applications,
    routes_assets,
    routes_cluster,
    routes_health,
    routes_jobs,
    routes_reports,
    routes_reviews,
    routes_workers,
    ws_progress,
)
from .config import Settings, get_settings
from .core.mdns import MdnsAdvertiser
from .db import init_db, make_session_factory


def create_app(settings: Settings | None = None, session_factory: sessionmaker | None = None, init_database: bool = True) -> FastAPI:
    settings = settings or get_settings()
    session_factory = session_factory or make_session_factory(settings)
    if init_database:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        settings.asset_root.mkdir(parents=True, exist_ok=True)
        init_db(session_factory)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.mdns_advertiser = None
        if settings.enable_mdns:
            advertiser = MdnsAdvertiser("TTB Label Reviewer", settings.host, settings.port)
            if advertiser.start():
                app.state.mdns_advertiser = advertiser
        try:
            yield
        finally:
            advertiser = getattr(app.state, "mdns_advertiser", None)
            if advertiser:
                advertiser.stop()

    app = FastAPI(title=settings.app_name, version=settings.version, lifespan=lifespan)
    app.state.settings = settings
    app.state.session_factory = session_factory
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from . import db

    def override_get_session():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[db.get_session] = override_get_session

    app.include_router(routes_health.router)
    app.include_router(routes_cluster.router)
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
    settings = get_settings()
    if settings.lan_mode:
        print("WARNING: LAN mode is enabled. Only run the coordinator on a trusted network.")
    uvicorn.run("apps.api.app.main:app", host=settings.host, port=settings.port, reload=False)


if __name__ == "__main__":
    main()
