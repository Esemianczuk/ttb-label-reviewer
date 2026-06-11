from __future__ import annotations

from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import Settings, get_settings


class Base(DeclarativeBase):
    pass


def engine_kwargs(database_url: str) -> dict:
    if database_url.startswith("sqlite"):
        return {"connect_args": {"check_same_thread": False}}
    return {}


def make_engine(settings: Settings):
    return create_engine(settings.database_url, future=True, **engine_kwargs(settings.database_url))


def make_session_factory(settings: Settings) -> sessionmaker[Session]:
    return sessionmaker(bind=make_engine(settings), autoflush=False, expire_on_commit=False, future=True)


settings = get_settings()
SessionLocal = make_session_factory(settings)


def init_db(session_factory: sessionmaker[Session] = SessionLocal) -> None:
    from . import models  # noqa: F401
    from .core.demo_identity import seed_demo_identity

    Base.metadata.create_all(bind=session_factory.kw["bind"])
    with session_factory() as session:
        seed_demo_identity(session)
        session.commit()


def get_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@contextmanager
def session_scope(session_factory: sessionmaker[Session] = SessionLocal):
    session = session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
