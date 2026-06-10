from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _database_url() -> str:
    return os.environ.get("TTB_API_DATABASE_URL", os.environ.get("DATABASE_URL", "sqlite:///./data/api.sqlite3"))


def _data_dir() -> Path:
    return Path(os.environ.get("TTB_API_DATA_DIR", "./data")).resolve()


def _max_upload_bytes() -> int:
    return int(os.environ.get("TTB_API_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))


def _default_lease_seconds() -> int:
    return int(os.environ.get("TTB_API_LEASE_SECONDS", "60"))


@dataclass(frozen=True)
class Settings:
    app_name: str = "TTB Label Reviewer API"
    version: str = "0.1.0"
    database_url: str = field(default_factory=_database_url)
    data_dir: Path = field(default_factory=_data_dir)
    asset_dir_name: str = "assets"
    max_upload_bytes: int = field(default_factory=_max_upload_bytes)
    default_lease_seconds: int = field(default_factory=_default_lease_seconds)
    allow_dev_sqlite: bool = field(default_factory=lambda: os.environ.get("TTB_API_ALLOW_DEV_SQLITE", "1") != "0")
    static_dir: Path = field(default_factory=lambda: (_repo_root() / "browser-demo" / "dist").resolve())

    @property
    def asset_root(self) -> Path:
        return self.data_dir / self.asset_dir_name


def get_settings() -> Settings:
    return Settings()
