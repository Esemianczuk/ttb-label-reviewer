from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


ApplicationSource = Literal["sample", "upload", "public_cola_registry", "manual"]
ImageRole = Literal["front", "back", "neck", "carton", "cola_sheet", "unknown"]
JobStatus = Literal["queued", "leased", "running", "completed", "failed", "cancelled"]


class ExpectedFields(BaseModel):
    productType: str = "unknown"
    brandName: str
    fancifulName: str | None = None
    classType: str
    alcoholContent: str
    netContents: str
    governmentWarningRequired: bool
    producerName: str | None = None
    countryOfOrigin: str | None = None
    applicationId: str | None = None
    labelId: str | None = None


class ApplicationMetadata(BaseModel):
    createdAt: datetime | None = None
    sourceUrl: str | None = None
    ttbId: str | None = None
    notes: str | None = None


class ApplicationCreate(BaseModel):
    id: str | None = None
    applicationId: str | None = None
    source: ApplicationSource = "manual"
    expectedFields: ExpectedFields
    metadata: ApplicationMetadata = Field(default_factory=ApplicationMetadata)


class ApplicationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    sessionId: str
    source: str
    status: str
    expectedFields: dict[str, Any]
    metadata: dict[str, Any]
    createdAt: datetime
    updatedAt: datetime
    assetCount: int = 0


class AssetRead(BaseModel):
    id: str
    applicationId: str | None
    sha256: str
    originalFilename: str
    mimeType: str
    sizeBytes: int
    role: str
    width: int | None = None
    height: int | None = None
    createdAt: datetime


class ReviewCreate(BaseModel):
    mode: Literal["backend", "distributed"] = "backend"
    priority: int = 100


class ReviewRead(BaseModel):
    id: str
    applicationId: str
    mode: str
    status: str
    result: dict[str, Any] | None = None
    createdAt: datetime
    completedAt: datetime | None = None


class JobRead(BaseModel):
    id: str
    applicationId: str
    reviewId: str | None
    sessionId: str
    jobType: str
    status: str
    priority: int
    payload: dict[str, Any]
    result: dict[str, Any] | None
    requiredCapabilities: dict[str, Any]
    assignedWorkerId: str | None
    leaseExpiresAt: datetime | None
    attempts: int
    error: str | None
    createdAt: datetime
    updatedAt: datetime
    startedAt: datetime | None
    completedAt: datetime | None


class WorkerRegister(BaseModel):
    id: str
    hostname: str
    platform: str
    arch: str
    version: str = "unknown"
    joinToken: str | None = None
    capabilities: dict[str, Any] = Field(default_factory=dict)
    calibration: dict[str, Any] = Field(default_factory=dict)
    maxConcurrency: int = 1


class WorkerHeartbeat(BaseModel):
    activeJobs: int = 0
    status: str = "online"
    capabilities: dict[str, Any] | None = None
    calibration: dict[str, Any] | None = None


class WorkerRead(BaseModel):
    id: str
    hostname: str
    platform: str
    arch: str
    version: str
    status: str
    capabilities: dict[str, Any]
    calibration: dict[str, Any]
    activeJobs: int
    maxConcurrency: int
    lastSeenAt: datetime
    createdAt: datetime


class WorkerEventRead(BaseModel):
    id: str
    workerId: str
    eventType: str
    payload: dict[str, Any]
    createdAt: datetime


class WorkerRegisterResponse(WorkerRead):
    workerSecret: str | None = None


class JoinTokenCreate(BaseModel):
    ttlSeconds: int | None = None
    coordinatorUrl: str | None = None


class JoinTokenRead(BaseModel):
    token: str
    expiresAt: datetime
    coordinatorUrl: str
    command: str
    mdnsService: str | None = None
    warning: str | None = None


class ClusterStatusRead(BaseModel):
    coordinatorUrl: str
    mdnsEnabled: bool
    mdnsService: str
    lanMode: bool
    warning: str | None = None


class JobClaimRequest(BaseModel):
    sessionId: str | None = None
    supportedJobTypes: list[str] = Field(default_factory=lambda: ["ocr", "validation", "evidence_crop", "report"])


class JobClaimResponse(BaseModel):
    job: JobRead | None
    assignment: dict[str, Any] | None = None


class JobCompleteRequest(BaseModel):
    jobId: str
    result: dict[str, Any] = Field(default_factory=dict)


class JobFailRequest(BaseModel):
    jobId: str
    error: str
    retryable: bool = True


class HealthRead(BaseModel):
    ok: bool
    database: str
    assetRoot: str
