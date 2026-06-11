import {
  createApplicantApplication,
  createAudit,
  createDemoSnapshot,
  createManualApplication,
  createReviewForApplication
} from "../../domain/application/demoData";
import type {
  ApplicationStatus,
  ConsoleSnapshot,
  ExpectedFields,
  FieldStatus,
  LabelImage,
  ProcessingMode,
  ReviewApplication,
  ReviewField,
  ReviewStatus,
  UserRole
} from "../../domain/application/types";
import { applicationStatusFromReviewStatus, normalizeApplicationStatus, normalizeReviewStatus } from "../../domain/application/status";

const STORAGE_KEY = "ttb-console-snapshot-v1";
const listeners = new Set<() => void>();
let cachedSnapshot: ConsoleSnapshot | null = null;

export function getSnapshot(): ConsoleSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      cachedSnapshot = migrateSnapshot(JSON.parse(raw) as ConsoleSnapshot);
      return cachedSnapshot;
    }
  } catch {
    // Local storage can be unavailable in locked-down browsers.
  }
  const snapshot = createDemoSnapshot();
  persist(snapshot);
  return snapshot;
}

export function resetSnapshot(): ConsoleSnapshot {
  const snapshot = createDemoSnapshot();
  persist(snapshot);
  notify();
  return snapshot;
}

export function subscribeToSnapshot(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setProcessingMode(mode: ProcessingMode): ConsoleSnapshot {
  return updateSnapshot((snapshot) => ({ ...snapshot, processingMode: mode }));
}

export function setActiveApplication(applicationId: string, actor = "Review Agent", role: UserRole = "reviewer"): ConsoleSnapshot {
  return updateSnapshot((snapshot) => ({
    ...snapshot,
    activeApplicationId: applicationId,
    auditEvents: [
      createAudit(`audit-${Date.now()}`, actor, role, "review.navigate", "applications", `Opened ${applicationId} in the review workbench.`),
      ...snapshot.auditEvents
    ]
  }));
}

export function queueApplication(applicationId: string): ConsoleSnapshot {
  return updateApplication(applicationId, (application) => ({
    ...application,
    status: "IN_REVIEW",
    updatedAt: new Date().toISOString()
  }));
}

export function autoReviewApplication(applicationId: string, mode?: ProcessingMode): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const processingMode = mode || snapshot.processingMode;
    const applications = snapshot.applications.map((application) => {
      if (application.id !== applicationId) return application;
      const review = createReviewForApplication(application, processingMode);
      return {
        ...application,
        review,
        status: applicationStatusFromReviewStatus(review.status),
        updatedAt: new Date().toISOString()
      };
    });
    return {
      ...snapshot,
      applications,
      auditEvents: [
        createAudit(
          `audit-${Date.now()}`,
          processingMode === "browser" ? "Browser Review Agent" : "Coordinator Review Agent",
          "reviewer",
          "review.auto",
          "reviews",
          `Auto review completed for ${applicationId} in ${processingMode} mode.`,
          { applicationId, processingMode }
        ),
        ...snapshot.auditEvents
      ]
    };
  });
}

export function updateFieldDecision(params: {
  applicationId: string;
  fieldId: string;
  status?: FieldStatus;
  reason?: string;
  actor?: string;
}): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const applications = snapshot.applications.map((application) => {
      if (application.id !== params.applicationId || !application.review) return application;
      const fields = application.review.fields.map((field) =>
        field.id === params.fieldId ? applyReviewerFieldDecision(field, params.status, params.reason) : field
      );
      const nextStatus = summarizeFields(fields);
      return {
        ...application,
        status: applicationStatusFromReviewStatus(nextStatus),
        updatedAt: new Date().toISOString(),
        review: {
          ...application.review,
          status: nextStatus,
          fields
        }
      };
    });

    return {
      ...snapshot,
      applications,
      auditEvents: [
        createAudit(
          `audit-${Date.now()}`,
          params.actor || "Review Agent",
          "reviewer",
          "review.field_override",
          "review_fields",
          `Updated ${params.fieldId} to ${params.status || "existing status"}.`,
          { applicationId: params.applicationId, fieldId: params.fieldId }
        ),
        ...snapshot.auditEvents
      ]
    };
  });
}

export function acceptAutoReview(applicationId: string, actor = "Review Agent"): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    let acceptedStatus: ReviewStatus | undefined;
    const applications = snapshot.applications.map((application) => {
      if (application.id !== applicationId) return application;
      if (!application.review) throw new Error("Run auto review before accepting the result.");
      acceptedStatus = application.review.status;
      return {
        ...application,
        status: applicationStatusFromReviewStatus(application.review.status),
        updatedAt: new Date().toISOString(),
        review: {
          ...application.review,
          reviewerOverallStatus: application.review.status,
          reviewerNotes: application.review.summary
        },
        metadata: {
          ...application.metadata,
          reviewerDecision: "accepted_auto" as const,
          reviewerDecisionNote: application.review.summary
        }
      };
    });
    return {
      ...snapshot,
      applications,
      auditEvents: [
        createAudit(
          `audit-${Date.now()}`,
          actor,
          "reviewer",
          "review.decision.accept_auto",
          "reviews",
          `Accepted automated review for ${applicationId}.`,
          { applicationId, reviewerOverallStatus: acceptedStatus }
        ),
        ...snapshot.auditEvents
      ]
    };
  });
}

export function finalizeReviewerDecision(params: {
  applicationId: string;
  decision: "approve" | "conditionally_approve" | "reject" | "escalate";
  note?: string;
  actor?: string;
}): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const actor = params.actor || "Review Agent";
    let summary = "";
    const applications = snapshot.applications.map((application) => {
      if (application.id !== params.applicationId) return application;
      if (!application.review) throw new Error("Run auto review before recording a reviewer decision.");
      const criticalFailures = unresolvedCriticalFailures(application);
      if (params.decision === "approve" && criticalFailures.length) {
        throw new Error("Approve is blocked while critical field failures are unresolved.");
      }

      const now = new Date().toISOString();
      if (params.decision === "approve") {
        summary = `Approved ${params.applicationId}.`;
        return {
          ...application,
          status: "APPROVED" as ApplicationStatus,
          updatedAt: now,
          review: { ...application.review, status: "PASS" as ReviewStatus, reviewerOverallStatus: "PASS" as ReviewStatus, reviewerNotes: params.note },
          metadata: { ...application.metadata, reviewerDecision: "approved" as const, reviewerDecisionNote: params.note }
        };
      }
      if (params.decision === "conditionally_approve") {
        summary = `Conditionally approved ${params.applicationId}.`;
        return {
          ...application,
          status: "CONDITIONALLY_APPROVED" as ApplicationStatus,
          updatedAt: now,
          review: {
            ...application.review,
            status: "PASS_WITH_WARNINGS" as ReviewStatus,
            reviewerOverallStatus: "PASS_WITH_WARNINGS" as ReviewStatus,
            reviewerNotes: params.note
          },
          metadata: { ...application.metadata, reviewerDecision: "conditionally_approved" as const, reviewerDecisionNote: params.note }
        };
      }
      if (params.decision === "reject") {
        summary = `Rejected ${params.applicationId}.`;
        return {
          ...application,
          status: "REJECTED" as ApplicationStatus,
          updatedAt: now,
          review: { ...application.review, status: "FAIL" as ReviewStatus, reviewerOverallStatus: "FAIL" as ReviewStatus, reviewerNotes: params.note },
          metadata: { ...application.metadata, reviewerDecision: "rejected" as const, reviewerDecisionNote: params.note }
        };
      }

      summary = `Escalated ${params.applicationId} to a senior label specialist.`;
      return {
        ...application,
        status: "IN_REVIEW" as ApplicationStatus,
        assignedTo: "Senior Label Specialist",
        updatedAt: now,
        review: {
          ...application.review,
          status: "NEEDS_REVIEW" as ReviewStatus,
          reviewerOverallStatus: "NEEDS_REVIEW" as ReviewStatus,
          reviewerNotes: params.note
        },
        metadata: { ...application.metadata, reviewerDecision: "escalated" as const, escalationReason: params.note, reviewerDecisionNote: params.note }
      };
    });
    return {
      ...snapshot,
      applications,
      auditEvents: [
        createAudit(
          `audit-${Date.now()}`,
          actor,
          "reviewer",
          `review.decision.${params.decision}`,
          "reviews",
          summary || `Recorded reviewer decision for ${params.applicationId}.`,
          { applicationId: params.applicationId, decision: params.decision, note: params.note }
        ),
        ...snapshot.auditEvents
      ]
    };
  });
}

export function processReviewerBatch(params: { applicationIds?: string[]; mode?: ProcessingMode; actor?: string } = {}): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const processingMode = params.mode || snapshot.processingMode;
    const ids = new Set(params.applicationIds || snapshot.applications.filter((application) => shouldProcessForReviewer(application)).map((application) => application.id));
    let processed = 0;
    const applications = snapshot.applications.map((application) => {
      if (!ids.has(application.id)) return application;
      const review = createReviewForApplication(application, processingMode);
      processed += 1;
      return {
        ...application,
        review,
        status: applicationStatusFromReviewStatus(review.status),
        updatedAt: new Date().toISOString()
      };
    });
    return {
      ...snapshot,
      applications,
      auditEvents: [
        createAudit(
          `audit-${Date.now()}`,
          params.actor || "Review Agent",
          "reviewer",
          "review.batch_process",
          "reviews",
          `Processed ${processed} application${processed === 1 ? "" : "s"} in ${processingMode} mode.`,
          { applicationIds: Array.from(ids), processingMode, processed }
        ),
        ...snapshot.auditEvents
      ]
    };
  });
}

export function updateReviewNotes(params: {
  applicationId: string;
  reviewerOverallStatus?: ReviewStatus;
  reviewerNotes?: string;
  actor?: string;
}): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const applications = snapshot.applications.map((application) => {
      if (application.id !== params.applicationId || !application.review) return application;
      return {
        ...application,
        status: params.reviewerOverallStatus ? applicationStatusFromReviewStatus(params.reviewerOverallStatus) : application.status,
        updatedAt: new Date().toISOString(),
        review: {
          ...application.review,
          status: params.reviewerOverallStatus || application.review.status,
          reviewerOverallStatus: params.reviewerOverallStatus,
          reviewerNotes: params.reviewerNotes
        }
      };
    });
    return {
      ...snapshot,
      applications,
      auditEvents: [
        createAudit(
          `audit-${Date.now()}`,
          params.actor || "Review Agent",
          "reviewer",
          "review.notes",
          "reviews",
          `Updated reviewer disposition for ${params.applicationId}.`,
          { applicationId: params.applicationId, reviewerOverallStatus: params.reviewerOverallStatus }
        ),
        ...snapshot.auditEvents
      ]
    };
  });
}

export function addManualUpload(params: {
  expectedFields: ExpectedFields;
  image: LabelImage;
  submitter?: string;
  notes?: string;
}): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const application = createManualApplication(params);
    return {
      ...snapshot,
      activeApplicationId: application.id,
      applications: [application, ...snapshot.applications],
      auditEvents: [
        createAudit(
          `audit-${Date.now()}`,
          params.submitter || "Evaluator upload",
          "applicant",
          "application.upload",
          "applications",
          `Created one-image manual application ${application.id}.`,
          { applicationId: application.id }
        ),
        ...snapshot.auditEvents
      ]
    };
  });
}

export function createApplicantDraft(params: {
  expectedFields: ExpectedFields;
  images: LabelImage[];
  submitter?: string;
  notes?: string;
  precheckSettings?: ReviewApplication["metadata"]["precheckSettings"];
}): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const application = createApplicantApplication(params);
    return {
      ...snapshot,
      activeApplicationId: application.id,
      applications: [application, ...snapshot.applications],
      auditEvents: [
        createAudit(
          `audit-${Date.now()}`,
          params.submitter || "Applicant",
          "applicant",
          "application.save_draft",
          "applications",
          `Saved draft application ${application.id} with ${params.images.length} label image${params.images.length === 1 ? "" : "s"}.`,
          { applicationId: application.id, imageCount: params.images.length }
        ),
        ...snapshot.auditEvents
      ]
    };
  });
}

export function runApplicantPrecheck(applicationId: string, mode?: ProcessingMode): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const processingMode = mode || snapshot.processingMode;
    let auditSummary = `Pre-check queued for ${applicationId}.`;
    const applications = snapshot.applications.map((application) => {
      if (application.id !== applicationId) return application;
      const review = createReviewForApplication(application, processingMode);
      const hasCriticalReview = review.fields.some((field) => field.severity === "critical" && field.status === "FAIL");
      const nextStatus: ApplicationStatus =
        !application.images.length || hasCriticalReview || review.status === "FAIL" ? "APPLICANT_FIX_REQUIRED" : "READY_TO_SUBMIT";
      auditSummary =
        nextStatus === "READY_TO_SUBMIT"
          ? `Pre-check passed for ${applicationId}.`
          : `Pre-check found applicant fixes for ${applicationId}.`;
      return {
        ...application,
        status: nextStatus,
        review,
        updatedAt: new Date().toISOString()
      };
    });
    return {
      ...snapshot,
      applications,
      auditEvents: [
        createAudit(`audit-${Date.now()}`, "Applicant", "applicant", "application.precheck", "applications", auditSummary, {
          applicationId,
          processingMode
        }),
        ...snapshot.auditEvents
      ]
    };
  });
}

export function submitApplicantApplication(applicationId: string): ConsoleSnapshot {
  return setApplicationStatus(applicationId, "SUBMITTED", "application.submit", "Submitted application for TTB label review.");
}

export function withdrawApplicantApplication(applicationId: string): ConsoleSnapshot {
  return setApplicationStatus(applicationId, "WITHDRAWN", "application.withdraw", "Withdrew application from review.");
}

export function requestApplicantCorrection(params: { applicationId: string; message: string; fields: string[]; actor?: string }): ConsoleSnapshot {
  if (!params.message.trim()) throw new Error("Correction requests require a message.");
  return updateSnapshot((snapshot) => ({
    ...snapshot,
    applications: snapshot.applications.map((application) =>
      application.id === params.applicationId
        ? {
            ...application,
            status: "NEEDS_CORRECTION",
            updatedAt: new Date().toISOString(),
            metadata: {
              ...application.metadata,
              correctionMessage: params.message,
              correctionFields: params.fields
            }
          }
        : application
    ),
    auditEvents: [
      createAudit(
        `audit-${Date.now()}`,
        params.actor || "Review Agent",
        "reviewer",
        "correction.request",
        "correctionRequests",
        `Requested applicant correction for ${params.applicationId}.`,
        { applicationId: params.applicationId, fields: params.fields }
      ),
      ...snapshot.auditEvents
    ]
  }));
}

export function respondToApplicantCorrection(params: {
  applicationId: string;
  response: string;
  expectedFields?: Partial<ExpectedFields>;
  images?: LabelImage[];
}): ConsoleSnapshot {
  return updateSnapshot((snapshot) => ({
    ...snapshot,
    activeApplicationId: params.applicationId,
    applications: snapshot.applications.map((application) =>
      application.id === params.applicationId
        ? {
            ...application,
            status: "RESUBMITTED",
            expectedFields: { ...application.expectedFields, ...params.expectedFields },
            images: params.images?.length ? params.images : application.images,
            updatedAt: new Date().toISOString(),
            metadata: {
              ...application.metadata,
              correctionResponse: params.response
            }
          }
        : application
    ),
    auditEvents: [
      createAudit(
        `audit-${Date.now()}`,
        "Applicant",
        "applicant",
        "correction.respond",
        "correctionRequests",
        `Responded to correction request for ${params.applicationId}.`,
        { applicationId: params.applicationId }
      ),
      ...snapshot.auditEvents
    ]
  }));
}

export function upsertApplication(application: ReviewApplication): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const exists = snapshot.applications.some((candidate) => candidate.id === application.id);
    return {
      ...snapshot,
      applications: exists
        ? snapshot.applications.map((candidate) => (candidate.id === application.id ? application : candidate))
        : [application, ...snapshot.applications],
      activeApplicationId: application.id
    };
  });
}

function setApplicationStatus(
  applicationId: string,
  status: ApplicationStatus,
  action: string,
  summary: string,
  actor = "Applicant",
  role: UserRole = "applicant"
): ConsoleSnapshot {
  return updateSnapshot((snapshot) => ({
    ...snapshot,
    activeApplicationId: applicationId,
    applications: snapshot.applications.map((application) =>
      application.id === applicationId ? { ...application, status, updatedAt: new Date().toISOString() } : application
    ),
    auditEvents: [
      createAudit(`audit-${Date.now()}`, actor, role, action, "applications", summary, { applicationId }),
      ...snapshot.auditEvents
    ]
  }));
}

function updateApplication(applicationId: string, updater: (application: ReviewApplication) => ReviewApplication): ConsoleSnapshot {
  return updateSnapshot((snapshot) => ({
    ...snapshot,
    applications: snapshot.applications.map((application) => (application.id === applicationId ? updater(application) : application))
  }));
}

function applyReviewerFieldDecision(field: ReviewField, status?: FieldStatus, reason?: string): ReviewField {
  const nextStatus = status ?? field.reviewerStatus;
  const nextReason = reason ?? field.reviewerReason;
  const currentEffectiveStatus = field.reviewerStatus || field.status;
  if (status && isPassFailFlip(currentEffectiveStatus, status) && !String(nextReason || "").trim()) {
    throw new Error("Override note is required when changing a field between pass and fail.");
  }
  return {
    ...field,
    reviewerStatus: nextStatus,
    reviewerReason: nextReason
  };
}

function isPassFailFlip(from: FieldStatus, to: FieldStatus): boolean {
  return from !== to && (from === "PASS" || from === "FAIL") && (to === "PASS" || to === "FAIL");
}

function unresolvedCriticalFailures(application: ReviewApplication): ReviewField[] {
  return (application.review?.fields || []).filter((field) => field.severity === "critical" && (field.reviewerStatus || field.status) === "FAIL");
}

function shouldProcessForReviewer(application: ReviewApplication): boolean {
  return !application.review && !["ARCHIVED", "WITHDRAWN"].includes(application.status);
}

function updateSnapshot(updater: (snapshot: ConsoleSnapshot) => ConsoleSnapshot): ConsoleSnapshot {
  const next = updater(getSnapshot());
  persist(next);
  notify();
  return next;
}

function persist(snapshot: ConsoleSnapshot): void {
  cachedSnapshot = snapshot;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Persistence is helpful for demos but not required for correctness.
  }
}

function migrateSnapshot(snapshot: ConsoleSnapshot): ConsoleSnapshot {
  return {
    ...snapshot,
    applications: snapshot.applications.map((application) => ({
      ...application,
      status: normalizeApplicationStatus(application.status),
      review: application.review
        ? {
            ...application.review,
            status: normalizeReviewStatus(application.review.status),
            reviewerOverallStatus: application.review.reviewerOverallStatus
              ? normalizeReviewStatus(application.review.reviewerOverallStatus)
              : undefined,
            fields: application.review.fields.map((field) => ({
              ...field,
              status: normalizeReviewStatus(field.status),
              reviewerStatus: field.reviewerStatus ? normalizeReviewStatus(field.reviewerStatus) : undefined
            }))
          }
        : undefined
    }))
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

function summarizeFields(fields: ReviewField[]): ReviewStatus {
  if (fields.some((field) => (field.reviewerStatus || field.status) === "FAIL")) return "FAIL";
  if (fields.some((field) => (field.reviewerStatus || field.status) === "NEEDS_REVIEW")) return "NEEDS_REVIEW";
  return "PASS";
}
