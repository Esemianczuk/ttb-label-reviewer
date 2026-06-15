export type UserRole = "applicant" | "reviewer" | "admin";

export type ProcessingMode = "browser" | "backend";

export type ApplicationStatus =
  | "DRAFT"
  | "PRECHECK_RUNNING"
  | "APPLICANT_FIX_REQUIRED"
  | "READY_TO_SUBMIT"
  | "SUBMITTED"
  | "IN_REVIEW"
  | "NEEDS_CORRECTION"
  | "RESUBMITTED"
  | "CONDITIONALLY_APPROVED"
  | "APPROVED"
  | "REJECTED"
  | "WITHDRAWN"
  | "ARCHIVED";

export type ComplianceStatus =
  | "PASS"
  | "FAIL"
  | "WARNING"
  | "NEEDS_REVIEW"
  | "NOT_FOUND"
  | "NOT_APPLICABLE"
  | "PASS_WITH_WARNINGS";

export type ReviewStatus = ComplianceStatus;

export type FieldStatus = ComplianceStatus;

export type ReviewRunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type JobStatus = "queued" | "leased" | "running" | "completed" | "failed" | "cancelled" | "retrying";

export type Severity = "info" | "warning" | "critical";

export type ExpectedFields = {
  productType: string;
  brandName: string;
  fancifulName?: string;
  classType: string;
  alcoholContent: string;
  netContents: string;
  governmentWarningRequired: boolean;
  producerName?: string;
  countryOfOrigin?: string;
  applicationId?: string;
  labelId?: string;
};

export type LabelImage = {
  id: string;
  role: "cola_sheet" | "front" | "back" | "neck" | "carton" | "other" | "unknown";
  name: string;
  url: string;
  mimeType: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  qualityWarnings?: string[];
  source: "sample" | "upload" | "api";
};

export type ReviewEvidence = {
  sourceImageId: string;
  excerpt: string;
  confidence: number;
  pageAnchor?: string;
  crop?: EvidenceCrop;
};

export type EvidenceCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
  unit: "pixel" | "ratio";
  source: "ocr" | "estimated";
};

export type ReviewField = {
  id: string;
  fieldKey: keyof ExpectedFields | "governmentWarning";
  label: string;
  expected: string;
  extracted: string;
  status: FieldStatus;
  severity: Severity;
  confidence: number;
  reason: string;
  evidence: ReviewEvidence[];
  reviewerStatus?: FieldStatus;
  reviewerReason?: string;
};

export type ReviewResult = {
  id: string;
  applicationId: string;
  mode: ProcessingMode;
  status: ReviewStatus;
  startedAt: string;
  completedAt?: string;
  fields: ReviewField[];
  summary: string;
  rawOcrText?: string;
  reviewerOverallStatus?: ReviewStatus;
  reviewerNotes?: string;
  engineTrace: string[];
};

export type ReviewApplication = {
  id: string;
  title: string;
  source: "sample" | "upload" | "public_cola_registry" | "manual";
  status: ApplicationStatus;
  expectedOutcome: "PASS" | "FAIL" | "NEEDS_REVIEW";
  expectedFields: ExpectedFields;
  images: LabelImage[];
  review?: ReviewResult;
  submitter: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
  metadata: {
    description?: string;
    ttbId?: string;
    applicationNumber?: string;
    publicRegistryUrl?: string;
    fixtureId?: string;
    packetPath?: string;
    demoReady?: boolean;
    demoAudit?: { status?: string; source?: string; reason?: string; note?: string; reviewed_common_fields?: string[] };
    notes?: string;
    correctionMessage?: string;
    correctionFields?: string[];
    correctionResponse?: string;
    reviewerDecision?: "accepted_auto" | "conditionally_approved" | "approved" | "rejected" | "escalated";
    reviewerDecisionNote?: string;
    reviewerDecisionReopened?: boolean;
    escalationReason?: string;
    archivedFromStatus?: ApplicationStatus;
  };
};

export type WorkerSnapshot = {
  id: string;
  hostname: string;
  platform: string;
  os?: string;
  arch?: string;
  cpu?: string;
  ramGb?: number;
  gpu?: string;
  status: "online" | "offline" | "busy" | "calibrating" | "draining" | "disabled";
  activeJobs: number;
  maxConcurrency: number;
  capabilities: string[];
  engines?: string[];
  latencyMs: number;
  throughput: string;
  avgMsPerImage?: number;
  drainMode?: boolean;
  disabled?: boolean;
  lastSeenAt: string;
};

export type AdminJob = {
  id: string;
  applicationId: string;
  type: "ocr" | "evidence_crop" | "validation" | "review_result";
  status: JobStatus;
  priority: number;
  workerId?: string;
  engine: string;
  attempts: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  schedulerReason: string;
};

export type AdminSettings = {
  preferredOcrEngine: string;
  browserOcrAllowed: boolean;
  backendCpuOcrAllowed: boolean;
  gpuOcrAllowed: boolean;
  maxConcurrency: number;
  validatorThreshold: number;
  warningStrictness: "lenient" | "standard" | "strict";
  retentionRawImagesDays: number;
  retentionJobsDays: number;
  keepReportsOnly: boolean;
};

export type BenchmarkRun = {
  id: string;
  label: string;
  imageCount: number;
  mode: ProcessingMode;
  status?: "completed" | "skipped" | "failed";
  workerId: string;
  workerChosen?: string;
  engineUsed?: string;
  concurrency?: number;
  totalMs?: number;
  wallClockMs?: number;
  averageMsPerImage: number;
  p50MsPerImage?: number;
  p95MsPerImage?: number;
  p50OcrMs: number;
  p95OcrMs: number;
  ocrMs?: number;
  validationMs?: number;
  queueMs?: number;
  p50ValidationMs?: number;
  p95ValidationMs?: number;
  imagesPerMinute: number;
  failures?: number;
  failedValidations?: number;
  notes?: string;
  createdAt: string;
};

export type OcrModelStatus = {
  id: string;
  status: "trained" | "baseline" | "unavailable";
  trainedModelLoaded: boolean;
  mode: string;
  modelDir: string;
  message: string;
  modelCard?: Record<string, unknown> | null;
  metrics?: Record<string, unknown> | null;
  failureReport?: Record<string, unknown> | null;
};

export type AuditEvent = {
  id: string;
  createdAt: string;
  actor: string;
  role: UserRole;
  action: string;
  resource: string;
  summary: string;
  metadata?: Record<string, unknown>;
};

export type ConsoleSnapshot = {
  applications: ReviewApplication[];
  workers: WorkerSnapshot[];
  jobs: AdminJob[];
  adminSettings: AdminSettings;
  benchmarkRuns: BenchmarkRun[];
  ocrModelStatus: OcrModelStatus[];
  auditEvents: AuditEvent[];
  activeApplicationId: string;
  processingMode: ProcessingMode;
};
