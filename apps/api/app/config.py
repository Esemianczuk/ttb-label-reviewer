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


def _host() -> str:
    return os.environ.get("TTB_API_HOST", "127.0.0.1")


def _port() -> int:
    return int(os.environ.get("TTB_API_PORT", "8000"))


def _join_token_ttl_seconds() -> int:
    return int(os.environ.get("TTB_JOIN_TOKEN_TTL_SECONDS", "900"))


@dataclass(frozen=True)
class Settings:
    app_name: str = "TTB Label Reviewer API"
    version: str = "0.1.0"
    database_url: str = field(default_factory=_database_url)
    data_dir: Path = field(default_factory=_data_dir)
    asset_dir_name: str = "assets"
    max_upload_bytes: int = field(default_factory=_max_upload_bytes)
    default_lease_seconds: int = field(default_factory=_default_lease_seconds)
    host: str = field(default_factory=_host)
    port: int = field(default_factory=_port)
    coordinator_public_url: str | None = field(default_factory=lambda: os.environ.get("TTB_COORDINATOR_URL"))
    join_token_ttl_seconds: int = field(default_factory=_join_token_ttl_seconds)
    require_worker_join_token: bool = field(default_factory=lambda: os.environ.get("TTB_REQUIRE_WORKER_JOIN_TOKEN", "1") != "0")
    enable_mdns: bool = field(default_factory=lambda: os.environ.get("TTB_ENABLE_MDNS", "0") == "1")
    lan_mode: bool = field(default_factory=lambda: os.environ.get("TTB_API_HOST", "127.0.0.1") in {"0.0.0.0", "::"})
    allow_dev_sqlite: bool = field(default_factory=lambda: os.environ.get("TTB_API_ALLOW_DEV_SQLITE", "1") != "0")
    static_dir: Path = field(default_factory=lambda: (_repo_root() / "browser-demo" / "dist").resolve())

    @property
    def asset_root(self) -> Path:
        return self.data_dir / self.asset_dir_name


def get_settings() -> Settings:
    return Settings()
