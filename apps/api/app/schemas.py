from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


ApplicationSource = Literal["sample", "upload", "public_cola_registry", "manual"]
ImageRole = Literal["front", "back", "neck", "carton", "cola_sheet", "unknown"]
JobStatus = Literal["queued", "leased", "running", "completed", "failed", "cancelled"]
UserRole = Literal["applicant", "reviewer", "admin"]
ApplicationTransition = Literal[
    "run_precheck",
    "precheck_pass",
    "precheck_fail",
    "submit",
    "start_review",
    "request_correction",
    "resubmit",
    "approve",
    "reject",
    "conditionally_approve",
    "withdraw",
    "archive",
]


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
    applicationNumber: str | None = None
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
    canonicalStatus: str
    ownerUserId: str | None = None
    organizationId: str | None = None
    expectedFields: dict[str, Any]
    metadata: dict[str, Any]
    createdAt: datetime
    updatedAt: datetime
    assetCount: int = 0
    versionCount: int = 0
    currentVersionNumber: int | None = None


class ApplicationTransitionRequest(BaseModel):
    transition: ApplicationTransition
    note: str | None = None
    fieldKeys: list[str] = Field(default_factory=list)
    reviewerOverride: bool = False
    acknowledgedNoChangeCorrection: bool = False
    expectedFields: ExpectedFields | None = None
    metadata: ApplicationMetadata | None = None


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
    ocrStrategy: Literal["paddleocr_authoritative", "tesseract_first_easyocr_escalation", "primary_only"] = "paddleocr_authoritative"
    primaryEngine: str = "paddleocr"
    fallbackEngine: str = "easyocr"
    fallbackMinConfidence: float = Field(default=0.86, ge=0.5, le=0.99)
    targetLatencyMs: int = Field(default=5000, ge=1000, le=30000)


class ReviewRead(BaseModel):
    id: str
    applicationId: str
    mode: str
    status: str
    canonicalStatus: str
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


class AuditEventRead(BaseModel):
    id: str
    actorUserId: str | None
    actorRole: str
    eventType: str
    entityType: str
    entityId: str
    summary: str
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    metadata: dict[str, Any]
    createdAt: datetime


class SettingRead(BaseModel):
    id: str
    key: str
    value: dict[str, Any]
    updatedAt: datetime


class SettingUpdate(BaseModel):
    value: dict[str, Any] = Field(default_factory=dict)


class OperationResult(BaseModel):
    ok: bool = True
    count: int = 0


class BenchmarkRunRequest(BaseModel):
    imageCount: int = Field(default=10, ge=1, le=500)
    mode: Literal["browser", "backend", "cluster"] = "backend"
    label: str | None = None


class BenchmarkRunRead(BaseModel):
    id: str
    label: str
    imageCount: int
    mode: str
    status: str = "completed"
    workerId: str
    workerChosen: str
    engineUsed: str
    concurrency: int = 1
    totalMs: float
    wallClockMs: float = 0
    averageMsPerImage: float
    p50MsPerImage: float = 0
    p95MsPerImage: float = 0
    imagesPerMinute: float
    ocrMs: float = 0
    validationMs: float = 0
    queueMs: float = 0
    p50OcrMs: float
    p95OcrMs: float
    p50ValidationMs: float = 0
    p95ValidationMs: float = 0
    failures: int = 0
    failedValidations: int = 0
    createdAt: datetime
    notes: str | None = None


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
    staticDir: str
    staticReady: bool
    lanMode: bool = False
    warning: str | None = None


class OrganizationRead(BaseModel):
    id: str
    name: str
    type: str
    createdAt: datetime


class UserRead(BaseModel):
    id: str
    email: str
    displayName: str
    role: str
    status: str
    organizationId: str | None = None
    createdAt: datetime
    updatedAt: datetime


class DemoLoginRequest(BaseModel):
    role: UserRole


class DemoLoginResponse(BaseModel):
    user: UserRead
    token: str
    tokenType: str = "bearer"
    expiresAt: datetime


class LogoutResponse(BaseModel):
    ok: bool = True


class AuthzCanRequest(BaseModel):
    resource: str
    action: str
    entityId: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)


class AuthzCanResponse(BaseModel):
    can: bool
    reason: str | None = None


class ApplicationVersionRead(BaseModel):
    id: str
    applicationId: str
    versionNumber: int
    expectedFields: dict[str, Any]
    metadata: dict[str, Any]
    createdByUserId: str | None = None
    createdAt: datetime
    submittedAt: datetime | None = None


class ReviewDecisionRead(BaseModel):
    id: str
    reviewId: str
    fieldKey: str
    autoStatus: str
    reviewerStatus: str | None = None
    effectiveStatus: str
    reviewerNote: str | None = None
    reviewerUserId: str | None = None
    createdAt: datetime
    updatedAt: datetime


class CorrectionRequestRead(BaseModel):
    id: str
    applicationId: str
    reviewId: str | None = None
    requestedByUserId: str | None = None
    status: str
    message: str
    fieldKeys: list[str]
    createdAt: datetime
    resolvedAt: datetime | None = None


class AuditEventRead(BaseModel):
    id: str
    actorUserId: str | None = None
    actorRole: str
    eventType: str
    entityType: str
    entityId: str
    summary: str
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    metadata: dict[str, Any]
    createdAt: datetime


class SettingRead(BaseModel):
    key: str
    value: dict[str, Any]
    updatedAt: datetime
