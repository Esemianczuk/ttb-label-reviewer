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


def _demo_token_ttl_seconds() -> int:
    return int(os.environ.get("TTB_DEMO_TOKEN_TTL_SECONDS", str(12 * 60 * 60)))


def _static_dir() -> Path:
    return Path(os.environ.get("TTB_API_STATIC_DIR", str(_repo_root() / "apps" / "console" / "dist"))).resolve()


def _benchmark_results_dir() -> Path:
    return Path(os.environ.get("TTB_BENCHMARK_RESULTS_DIR", str(_repo_root() / "benchmarks" / "results"))).resolve()


def _cors_allow_origins() -> tuple[str, ...]:
    configured = os.environ.get("TTB_API_CORS_ORIGINS")
    if configured:
        origins = tuple(origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip() and origin.strip() != "*")
        if origins:
            return origins
    hosts = ("localhost", "127.0.0.1")
    ports = ("3000", "3001", "4173", "4174", "5173", "5174", "8000")
    return tuple(f"http://{host}:{port}" for host in hosts for port in ports)


def _worker_stale_seconds() -> int:
    return int(os.environ.get("TTB_WORKER_STALE_SECONDS", "180"))


def _lan_mode_override() -> bool | None:
    raw = os.environ.get("TTB_API_LAN_MODE")
    if raw is None:
        return None
    return raw == "1"


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
    demo_token_secret: str = field(default_factory=lambda: os.environ.get("TTB_DEMO_TOKEN_SECRET", "local-dev-demo-token-secret"))
    demo_token_ttl_seconds: int = field(default_factory=_demo_token_ttl_seconds)
    require_worker_join_token: bool = field(default_factory=lambda: os.environ.get("TTB_REQUIRE_WORKER_JOIN_TOKEN", "1") != "0")
    worker_stale_seconds: int = field(default_factory=_worker_stale_seconds)
    enable_mdns: bool = field(default_factory=lambda: os.environ.get("TTB_ENABLE_MDNS", "0") == "1")
    lan_mode_override: bool | None = field(default_factory=_lan_mode_override)
    allow_dev_sqlite: bool = field(default_factory=lambda: os.environ.get("TTB_API_ALLOW_DEV_SQLITE", "1") != "0")
    static_dir: Path = field(default_factory=_static_dir)
    benchmark_results_dir: Path = field(default_factory=_benchmark_results_dir)
    cors_allow_origins: tuple[str, ...] = field(default_factory=_cors_allow_origins)
    cors_allow_headers: tuple[str, ...] = ("Authorization", "Content-Type", "X-Session-Id", "X-Join-Token")
    cors_allow_methods: tuple[str, ...] = ("GET", "POST", "PATCH", "DELETE", "OPTIONS")

    @property
    def asset_root(self) -> Path:
        return self.data_dir / self.asset_dir_name

    @property
    def lan_mode(self) -> bool:
        if self.lan_mode_override is not None:
            return self.lan_mode_override
        return self.host in {"0.0.0.0", "::"}

    @property
    def lan_warning(self) -> str | None:
        if not self.lan_mode:
            return None
        return (
            "LAN MODE ENABLED: coordinator APIs are reachable from the local network. "
            "Use only on a trusted network with explicit CORS origins and short-lived worker join tokens."
        )


def get_settings() -> Settings:
    return Settings()
