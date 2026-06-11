export type UserRole = "applicant" | "reviewer" | "admin";

export type ProcessingMode = "browser" | "backend" | "cluster";

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

export type ReviewStatus =
  | "PASS"
  | "FAIL"
  | "WARNING"
  | "NEEDS_REVIEW"
  | "NOT_FOUND"
  | "NOT_APPLICABLE"
  | "PASS_WITH_WARNINGS";

export type FieldStatus = ReviewStatus;

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
    publicRegistryUrl?: string;
    fixtureId?: string;
    packetPath?: string;
    notes?: string;
    correctionMessage?: string;
    correctionFields?: string[];
    correctionResponse?: string;
    precheckSettings?: {
      runOcr: boolean;
      validateGovernmentWarning: boolean;
      requireAtLeastOneImage: boolean;
      autoSubmitWhenReady: boolean;
    };
  };
};

export type WorkerSnapshot = {
  id: string;
  hostname: string;
  platform: string;
  status: "online" | "offline" | "busy" | "calibrating";
  activeJobs: number;
  maxConcurrency: number;
  capabilities: string[];
  latencyMs: number;
  throughput: string;
  lastSeenAt: string;
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
  auditEvents: AuditEvent[];
  activeApplicationId: string;
  processingMode: ProcessingMode;
};
