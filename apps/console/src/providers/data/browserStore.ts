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
        field.id === params.fieldId
          ? {
              ...field,
              reviewerStatus: params.status ?? field.reviewerStatus,
              reviewerReason: params.reason ?? field.reviewerReason
            }
          : field
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
