from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def json_column_type():
    return JSON().with_variant(JSONB, "postgresql")


def new_uuid() -> str:
    return str(uuid.uuid4())


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    session_id: Mapped[str] = mapped_column(String(120), index=True)
    owner_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    organization_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(40), default="created", index=True)
    expected_fields: Mapped[dict] = mapped_column(json_column_type(), default=dict)
    metadata_json: Mapped[dict] = mapped_column(json_column_type(), default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    assets: Mapped[list["Asset"]] = relationship(back_populates="application")
    reviews: Mapped[list["Review"]] = relationship(back_populates="application")
    jobs: Mapped[list["Job"]] = relationship(back_populates="application")
    correction_requests: Mapped[list["CorrectionRequest"]] = relationship(back_populates="application")
    versions: Mapped[list["ApplicationVersion"]] = relationship(
        back_populates="application",
        cascade="all, delete-orphan",
        order_by="ApplicationVersion.version_number",
    )
    owner: Mapped["User | None"] = relationship(back_populates="applications")
    organization: Mapped["Organization | None"] = relationship(back_populates="applications")


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    application_id: Mapped[str | None] = mapped_column(ForeignKey("applications.id"), nullable=True, index=True)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(80))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    storage_path: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(40), default="unknown")
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    application: Mapped[Application | None] = relationship(back_populates="assets")


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id"), index=True)
    mode: Mapped[str] = mapped_column(String(40), default="backend")
    status: Mapped[str] = mapped_column(String(40), default="queued", index=True)
    result_json: Mapped[dict | None] = mapped_column(json_column_type(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    application: Mapped[Application] = relationship(back_populates="reviews")
    jobs: Mapped[list["Job"]] = relationship(back_populates="review")
    decisions: Mapped[list["ReviewDecision"]] = relationship(back_populates="review", cascade="all, delete-orphan")
    correction_requests: Mapped[list["CorrectionRequest"]] = relationship(back_populates="review")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id"), index=True)
    review_id: Mapped[str | None] = mapped_column(ForeignKey("reviews.id"), nullable=True, index=True)
    session_id: Mapped[str] = mapped_column(String(120), index=True)
    job_type: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(40), default="queued", index=True)
    priority: Mapped[int] = mapped_column(Integer, default=100, index=True)
    payload_json: Mapped[dict] = mapped_column(json_column_type(), default=dict)
    result_json: Mapped[dict | None] = mapped_column(json_column_type(), nullable=True)
    required_capabilities: Mapped[dict] = mapped_column(json_column_type(), default=dict)
    assigned_worker_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    application: Mapped[Application] = relationship(back_populates="jobs")
    review: Mapped[Review | None] = relationship(back_populates="jobs")


class Worker(Base):
    __tablename__ = "workers"

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    hostname: Mapped[str] = mapped_column(String(255))
    platform: Mapped[str] = mapped_column(String(80))
    arch: Mapped[str] = mapped_column(String(80))
    version: Mapped[str] = mapped_column(String(80), default="unknown")
    status: Mapped[str] = mapped_column(String(40), default="online", index=True)
    capabilities: Mapped[dict] = mapped_column(json_column_type(), default=dict)
    calibration: Mapped[dict] = mapped_column(json_column_type(), default=dict)
    active_jobs: Mapped[int] = mapped_column(Integer, default=0)
    max_concurrency: Mapped[int] = mapped_column(Integer, default=1)
    worker_secret_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class WorkerJoinToken(Base):
    __tablename__ = "worker_join_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    worker_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class WorkerEvent(Base):
    __tablename__ = "worker_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    worker_id: Mapped[str] = mapped_column(String(120), index=True)
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    payload_json: Mapped[dict] = mapped_column(json_column_type(), default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(255), index=True)
    type: Mapped[str] = mapped_column(String(80), default="producer", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    users: Mapped[list["User"]] = relationship(back_populates="organization")
    applications: Mapped[list["Application"]] = relationship(back_populates="organization")


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(40), default="active", index=True)
    organization_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    organization: Mapped[Organization | None] = relationship(back_populates="users")
    applications: Mapped[list["Application"]] = relationship(back_populates="owner")
    application_versions: Mapped[list["ApplicationVersion"]] = relationship(back_populates="created_by")
    review_decisions: Mapped[list["ReviewDecision"]] = relationship(back_populates="reviewer")
    correction_requests: Mapped[list["CorrectionRequest"]] = relationship(back_populates="requested_by")
    audit_events: Mapped[list["AuditEvent"]] = relationship(back_populates="actor")


class ApplicationVersion(Base):
    __tablename__ = "application_versions"
    __table_args__ = (UniqueConstraint("application_id", "version_number", name="uq_application_versions_application_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id"), index=True)
    version_number: Mapped[int] = mapped_column(Integer)
    expected_fields: Mapped[dict] = mapped_column(json_column_type(), default=dict)
    metadata_json: Mapped[dict] = mapped_column(json_column_type(), default=dict)
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    application: Mapped[Application] = relationship(back_populates="versions")
    created_by: Mapped[User | None] = relationship(back_populates="application_versions")


class ReviewDecision(Base):
    __tablename__ = "review_decisions"
    __table_args__ = (UniqueConstraint("review_id", "field_key", name="uq_review_decisions_review_field"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    review_id: Mapped[str] = mapped_column(ForeignKey("reviews.id"), index=True)
    field_key: Mapped[str] = mapped_column(String(120), index=True)
    auto_status: Mapped[str] = mapped_column(String(40))
    reviewer_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    effective_status: Mapped[str] = mapped_column(String(40), index=True)
    reviewer_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewer_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    review: Mapped[Review] = relationship(back_populates="decisions")
    reviewer: Mapped[User | None] = relationship(back_populates="review_decisions")


class CorrectionRequest(Base):
    __tablename__ = "correction_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id"), index=True)
    review_id: Mapped[str | None] = mapped_column(ForeignKey("reviews.id"), nullable=True, index=True)
    requested_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(40), default="open", index=True)
    message: Mapped[str] = mapped_column(Text)
    field_keys: Mapped[list[str]] = mapped_column(json_column_type(), default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    application: Mapped[Application] = relationship(back_populates="correction_requests")
    review: Mapped[Review | None] = relationship(back_populates="correction_requests")
    requested_by: Mapped[User | None] = relationship(back_populates="correction_requests")


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    actor_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    actor_role: Mapped[str] = mapped_column(String(40), index=True)
    event_type: Mapped[str] = mapped_column(String(120), index=True)
    entity_type: Mapped[str] = mapped_column(String(120), index=True)
    entity_id: Mapped[str] = mapped_column(String(120), index=True)
    summary: Mapped[str] = mapped_column(Text)
    before_json: Mapped[dict | None] = mapped_column(json_column_type(), nullable=True)
    after_json: Mapped[dict | None] = mapped_column(json_column_type(), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(json_column_type(), default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)

    actor: Mapped[User | None] = relationship(back_populates="audit_events")


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value_json: Mapped[dict] = mapped_column(json_column_type(), default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)
