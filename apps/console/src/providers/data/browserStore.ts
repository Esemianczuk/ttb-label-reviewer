import {
  createAdminJobsForApplications,
  createApplicantApplication,
  createAudit,
  createDefaultAdminSettings,
  createDemoBenchmarkRuns,
  createDemoSnapshot,
  fieldLabels,
  createManualApplication,
  createReviewForApplication
} from "../../domain/application/demoData";
import { createBrowserOcrReview } from "../../domain/application/browserOcrReview";
import { annotateAuditApplicationNumbers, applicationNumberFor, assignApplicationNumbers } from "../../domain/application/applicationNumber";
import type {
  AdminSettings,
  ApplicationStatus,
  BenchmarkRun,
  ConsoleSnapshot,
  ExpectedFields,
  FieldStatus,
  LabelImage,
  ProcessingMode,
  ReviewApplication,
  ReviewField,
  ReviewResult,
  ReviewStatus,
  UserRole
} from "../../domain/application/types";
import {
  normalizeApplicationStatus,
  normalizeReviewStatus,
  reviewerWorkflowStatusFromCompliance
} from "../../domain/application/status";

const STORAGE_KEY = "ttb-console-snapshot-v1";
const RETIRED_SAMPLE_URL_PARTS = ["/label-packets/"];
const METADATA_ONLY_REVIEW_FIELDS = new Set(["applicationId", "labelId"]);
const listeners = new Set<() => void>();
let cachedSnapshot: ConsoleSnapshot | null = null;

export function getSnapshot(): ConsoleSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const snapshot = migrateSnapshot(JSON.parse(raw) as ConsoleSnapshot);
      persist(snapshot);
      return snapshot;
    }
  } catch {
    // Local storage can be unavailable in locked-down browsers.
  }
  const snapshot = createDemoSnapshot();
  const annotated = annotateAuditApplicationNumbers(snapshot);
  persist(annotated);
  return annotated;
}

export function resetSnapshot(): ConsoleSnapshot {
  const snapshot = annotateAuditApplicationNumbers(createDemoSnapshot());
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

export function updateAdminSettings(settings: Partial<AdminSettings>, actor = "Demo Admin"): ConsoleSnapshot {
  return updateSnapshot((snapshot) => ({
    ...snapshot,
    adminSettings: {
      ...snapshot.adminSettings,
      ...settings
    },
    auditEvents: [
      createAudit(`audit-${Date.now()}`, actor, "admin", "settings.update", "settings", "Updated operations settings.", {
        changedKeys: Object.keys(settings)
      }),
      ...snapshot.auditEvents
    ]
  }));
}

export function updateWorkerOperation(params: {
  workerId: string;
  action: "recalibrate" | "drain" | "disable" | "enable";
  actor?: string;
}): ConsoleSnapshot {
  return updateSnapshot((snapshot) => ({
    ...snapshot,
    workers: snapshot.workers.map((worker) => {
      if (worker.id !== params.workerId) return worker;
      if (params.action === "recalibrate") {
        return { ...worker, status: "calibrating", lastSeenAt: new Date().toISOString(), avgMsPerImage: Math.max(120, (worker.avgMsPerImage || 650) - 24) };
      }
      if (params.action === "drain") {
        return { ...worker, drainMode: true, status: worker.activeJobs ? "busy" : "online", maxConcurrency: Math.max(1, worker.activeJobs) };
      }
      if (params.action === "disable") {
        return { ...worker, disabled: true, drainMode: true, status: "offline", maxConcurrency: 0 };
      }
      return { ...worker, disabled: false, drainMode: false, status: "online", maxConcurrency: Math.max(worker.maxConcurrency, 2) };
    }),
    auditEvents: [
      createAudit(
        `audit-${Date.now()}`,
        params.actor || "Demo Admin",
        "admin",
        `worker.${params.action}`,
        "workers",
        `Admin requested ${params.action} for ${params.workerId}.`,
        { workerId: params.workerId, action: params.action }
      ),
      ...snapshot.auditEvents
    ]
  }));
}

export function updateJobOperation(params: {
  jobId: string;
  action: "retry" | "cancel" | "raise_priority";
  actor?: string;
}): ConsoleSnapshot {
  return updateSnapshot((snapshot) => ({
    ...snapshot,
    jobs: snapshot.jobs.map((job) => {
      if (job.id !== params.jobId) return job;
      if (params.action === "retry") {
        return {
          ...job,
          status: "retrying" as const,
          attempts: job.attempts + 1,
          priority: Math.min(100, job.priority + 10),
          startedAt: undefined,
          completedAt: undefined,
          durationMs: undefined,
          schedulerReason: "Admin manually retried this job."
        };
      }
      if (params.action === "cancel") {
        return { ...job, status: "cancelled" as const, completedAt: new Date().toISOString(), schedulerReason: "Admin cancelled this job." };
      }
      return { ...job, priority: Math.min(100, job.priority + 15), schedulerReason: "Admin raised job priority." };
    }),
    auditEvents: [
      createAudit(
        `audit-${Date.now()}`,
        params.actor || "Demo Admin",
        "admin",
        `job.${params.action}`,
        "jobs",
        `Admin requested ${params.action} for ${params.jobId}.`,
        { jobId: params.jobId, action: params.action }
      ),
      ...snapshot.auditEvents
    ]
  }));
}

export function runAdminBenchmark(params: { imageCount: number; label?: string; mode?: ProcessingMode; actor?: string }): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const worker = snapshot.workers.find((candidate) => !candidate.disabled) || snapshot.workers[0];
    const average = Math.max(120, Math.round((worker?.avgMsPerImage || 650) * (params.mode === "cluster" ? 0.72 : params.mode === "backend" ? 0.88 : 1)));
    const totalMs = average * params.imageCount;
    const run: BenchmarkRun = {
      id: `benchmark-${Date.now()}`,
      label: params.label || `${params.imageCount} image ${params.mode || snapshot.processingMode} run`,
      imageCount: params.imageCount,
      mode: params.mode || snapshot.processingMode,
      status: "completed",
      workerId: worker?.id || "worker-local-browser",
      workerChosen: worker?.id || "worker-local-browser",
      engineUsed: worker?.engines?.[0] || "browser-fixture",
      concurrency: worker?.maxConcurrency || 1,
      totalMs,
      wallClockMs: totalMs,
      averageMsPerImage: average,
      p50MsPerImage: average,
      p95MsPerImage: Math.round(average * 1.65),
      p50OcrMs: Math.round(average * 0.92),
      p95OcrMs: Math.round(average * 1.65),
      ocrMs: Math.round(average * params.imageCount * 0.72),
      validationMs: Math.round(average * params.imageCount * 0.12),
      queueMs: Math.round(average * params.imageCount * 0.16),
      p50ValidationMs: Math.round(average * 0.12),
      p95ValidationMs: Math.round(average * 0.2),
      imagesPerMinute: Math.round(60_000 / average),
      failures: 0,
      failedValidations: 0,
      createdAt: new Date().toISOString()
    };
    return {
      ...snapshot,
      benchmarkRuns: [run, ...snapshot.benchmarkRuns],
      auditEvents: [
        createAudit(
          `audit-${Date.now()}`,
          params.actor || "Demo Admin",
          "admin",
          "benchmark.run",
          "benchmarks",
          `Ran benchmark for ${params.imageCount} images.`,
          { benchmarkId: run.id, imageCount: params.imageCount, mode: run.mode }
        ),
        ...snapshot.auditEvents
      ]
    };
  });
}

export function purgeRawImages(actor = "Demo Admin"): ConsoleSnapshot {
  return updateSnapshot((snapshot) => ({
    ...snapshot,
    applications: snapshot.applications.map((application) => ({
      ...application,
      images: application.review || snapshot.adminSettings.keepReportsOnly ? [] : application.images,
      metadata: {
        ...application.metadata,
        notes: [application.metadata.notes, "Raw image assets purged by retention policy."].filter(Boolean).join(" ")
      }
    })),
    auditEvents: [
      createAudit(`audit-${Date.now()}`, actor, "admin", "retention.purge_raw_images", "labelAssets", "Purged raw image assets for reviewed packets."),
      ...snapshot.auditEvents
    ]
  }));
}

export function purgeOldJobs(actor = "Demo Admin"): ConsoleSnapshot {
  return updateSnapshot((snapshot) => ({
    ...snapshot,
    jobs: snapshot.jobs.filter((job) => !["completed", "failed", "cancelled"].includes(job.status)),
    auditEvents: [
      createAudit(`audit-${Date.now()}`, actor, "admin", "retention.purge_old_jobs", "jobs", "Purged completed, failed, and cancelled jobs."),
      ...snapshot.auditEvents
    ]
  }));
}

export function deleteApplicationPacket(applicationId: string, actor = "Demo Admin"): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const applicationNumber = applicationNumberForId(snapshot, applicationId);
    return {
      ...snapshot,
      applications: snapshot.applications.filter((application) => application.id !== applicationId),
      jobs: snapshot.jobs.filter((job) => job.applicationId !== applicationId),
      activeApplicationId: snapshot.activeApplicationId === applicationId ? snapshot.applications.find((application) => application.id !== applicationId)?.id || "" : snapshot.activeApplicationId,
      auditEvents: [
        createAudit(`audit-${Date.now()}`, actor, "admin", "retention.delete_packet", "applications", `Deleted application packet ${applicationNumber}.`, {
          applicationId,
          applicationNumber
        }),
        ...snapshot.auditEvents
      ]
    };
  });
}

export function purgeAllDemoData(actor = "Demo Admin"): ConsoleSnapshot {
  return updateSnapshot((snapshot) => ({
    ...snapshot,
    applications: [],
    jobs: [],
    benchmarkRuns: [],
    activeApplicationId: "",
    auditEvents: [
      createAudit(`audit-${Date.now()}`, actor, "admin", "retention.purge_all", "applications", "Purged all demo applications, jobs, and benchmark results.")
    ]
  }));
}

export function setActiveApplication(applicationId: string, actor = "Review Agent", role: UserRole = "reviewer"): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const applicationNumber = applicationNumberForId(snapshot, applicationId);
    return {
      ...snapshot,
      activeApplicationId: applicationId,
      auditEvents: [
        createAudit(`audit-${Date.now()}`, actor, role, "review.navigate", "applications", `Opened ${applicationNumber} in the review workbench.`, {
          applicationId,
          applicationNumber
        }),
        ...snapshot.auditEvents
      ]
    };
  });
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
    const applicationNumber = applicationNumberForId(snapshot, applicationId);
    const applications = snapshot.applications.map((application) => {
      if (application.id !== applicationId) return application;
      const review = createReviewForApplication(application, processingMode);
      return {
        ...application,
        review,
        status: reviewerWorkflowStatusFromCompliance(review.status),
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
          `Auto review completed for ${applicationNumber} in ${processingMode} mode.`,
          { applicationId, applicationNumber, processingMode }
        ),
        ...snapshot.auditEvents
      ]
    };
  });
}

export async function autoReviewApplicationWithBrowserOcr(
  applicationId: string,
  mode?: ProcessingMode,
  options: { workerOverride?: string; onProgress?: (message: string) => void } = {}
): Promise<ConsoleSnapshot> {
  const snapshot = getSnapshot();
  const processingMode = mode || snapshot.processingMode;
  const application = snapshot.applications.find((candidate) => candidate.id === applicationId);
  if (!application) throw new Error(`Application ${applicationId} was not found.`);
  if (processingMode !== "browser") return autoReviewApplication(applicationId, processingMode);

  updateApplication(applicationId, (candidate) => ({
    ...candidate,
    status: "IN_REVIEW",
    updatedAt: new Date().toISOString()
  }));

  const review = await createBrowserOcrReview(application, processingMode, options);
  return applyCompletedReview({
    applicationId,
    review,
    actor: "Browser Review Agent",
    role: "reviewer",
    action: "review.auto",
    summary: `Browser OCR review completed for ${applicationNumberForId(snapshot, applicationId)}.`
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
    const currentApplication = snapshot.applications.find((application) => application.id === params.applicationId);
    if (currentApplication && isReviewerClosedStatus(currentApplication.status)) {
      throw new Error("Reopen the application before editing reviewer field decisions.");
    }
    const applications = snapshot.applications.map((application) => {
      if (application.id !== params.applicationId || !application.review) return application;
      const fields = application.review.fields.map((field) =>
        field.id === params.fieldId ? applyReviewerFieldDecision(field, params.status, params.reason) : field
      );
      const nextStatus = summarizeFields(fields);
      return {
        ...application,
        status: reviewerWorkflowStatusFromCompliance(nextStatus),
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
          `Updated ${fieldDecisionLabel(params.fieldId)} for ${applicationNumberForId(snapshot, params.applicationId)} to ${params.status || "existing status"}.`,
          { applicationId: params.applicationId, applicationNumber: applicationNumberForId(snapshot, params.applicationId), fieldId: params.fieldId }
        ),
        ...snapshot.auditEvents
      ]
    };
  });
}

export function acceptAutoReview(applicationId: string, actor = "Review Agent"): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    let acceptedStatus: ReviewStatus | undefined;
    const applicationNumber = applicationNumberForId(snapshot, applicationId);
    const applications = snapshot.applications.map((application) => {
      if (application.id !== applicationId) return application;
      if (!application.review) throw new Error("Run auto review before accepting the result.");
      acceptedStatus = application.review.status;
      return {
        ...application,
        status: "IN_REVIEW" as ApplicationStatus,
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
          `Accepted automated review for ${applicationNumber}.`,
          { applicationId, applicationNumber, reviewerOverallStatus: acceptedStatus }
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
    const applicationNumber = applicationNumberForId(snapshot, params.applicationId);
    const applications = snapshot.applications.map((application) => {
      if (application.id !== params.applicationId) return application;
      if (!application.review) throw new Error("Run auto review before recording a reviewer decision.");
      const criticalFailures = application.review.fields.filter(
        (field) => field.severity === "critical" && !["PASS", "PASS_WITH_WARNINGS", "NOT_APPLICABLE"].includes(field.reviewerStatus || field.status)
      );
      const note = (params.note || "").trim();
      if (params.decision === "approve" && criticalFailures.length) {
        throw new Error("Approve is blocked while critical field failures are unresolved.");
      }
      if (params.decision === "approve" && application.status === "NEEDS_CORRECTION") {
        throw new Error("Approve is blocked while a correction request is open.");
      }
      if (params.decision === "conditionally_approve" && !note) {
        throw new Error("Conditionally approve requires a note with the proposed correction or condition.");
      }
      if (params.decision === "reject" && !note) {
        throw new Error("Reject requires a reason.");
      }
      if (params.decision === "escalate" && !note) {
        throw new Error("Escalate requires a reason.");
      }

      const now = new Date().toISOString();
      if (params.decision === "approve") {
        summary = `Approved ${applicationNumber}.`;
        const { reviewerDecisionReopened: _reopened, ...metadata } = application.metadata;
        return {
          ...application,
          status: "APPROVED" as ApplicationStatus,
          updatedAt: now,
          review: { ...application.review, status: "PASS" as ReviewStatus, reviewerOverallStatus: "PASS" as ReviewStatus, reviewerNotes: params.note },
          metadata: { ...metadata, reviewerDecision: "approved" as const, reviewerDecisionNote: params.note }
        };
      }
      if (params.decision === "conditionally_approve") {
        summary = `Conditionally approved ${applicationNumber}.`;
        const { reviewerDecisionReopened: _reopened, ...metadata } = application.metadata;
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
          metadata: { ...metadata, reviewerDecision: "conditionally_approved" as const, reviewerDecisionNote: params.note }
        };
      }
      if (params.decision === "reject") {
        summary = `Rejected ${applicationNumber}.`;
        const { reviewerDecisionReopened: _reopened, ...metadata } = application.metadata;
        return {
          ...application,
          status: "REJECTED" as ApplicationStatus,
          updatedAt: now,
          review: { ...application.review, status: "FAIL" as ReviewStatus, reviewerOverallStatus: "FAIL" as ReviewStatus, reviewerNotes: params.note },
          metadata: { ...metadata, reviewerDecision: "rejected" as const, reviewerDecisionNote: params.note }
        };
      }

      summary = `Escalated ${applicationNumber} to a senior label specialist.`;
      const { reviewerDecisionReopened: _reopened, ...metadata } = application.metadata;
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
        metadata: { ...metadata, reviewerDecision: "escalated" as const, escalationReason: params.note, reviewerDecisionNote: params.note }
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
          summary || `Recorded reviewer decision for ${applicationNumber}.`,
          { applicationId: params.applicationId, applicationNumber, decision: params.decision, note: params.note }
        ),
        ...snapshot.auditEvents
      ]
    };
  });
}

export function reopenReviewerDecision(applicationId: string, actor = "Review Agent"): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const currentApplication = snapshot.applications.find((application) => application.id === applicationId);
    if (!currentApplication) throw new Error(`Application ${applicationId} was not found.`);
    if (!currentApplication.review) throw new Error("Run auto review before reopening a reviewer decision.");
    if (!isReviewerClosedStatus(currentApplication.status)) return snapshot;
    return {
      ...snapshot,
      applications: snapshot.applications.map((application) => {
        if (application.id !== applicationId || !application.review) return application;
        const { reviewerDecision: _decision, escalationReason: _escalationReason, ...metadata } = application.metadata;
        return {
          ...application,
          status: "IN_REVIEW" as ApplicationStatus,
          updatedAt: new Date().toISOString(),
          review: {
            ...application.review,
            reviewerOverallStatus: undefined
          },
          metadata: {
            ...metadata,
            reviewerDecisionReopened: true
          }
        };
      }),
      auditEvents: [
        createAudit(`audit-${Date.now()}`, actor, "reviewer", "review.decision.reopen", "reviews", `Reopened reviewer decision for ${applicationNumberForId(snapshot, applicationId)}.`, {
          applicationId,
          applicationNumber: applicationNumberForId(snapshot, applicationId)
        }),
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
        status: reviewerWorkflowStatusFromCompliance(review.status),
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
    const currentApplication = snapshot.applications.find((application) => application.id === params.applicationId);
    if (currentApplication && isReviewerClosedStatus(currentApplication.status)) {
      throw new Error("Reopen the application before editing reviewer notes.");
    }
    const applications = snapshot.applications.map((application) => {
      if (application.id !== params.applicationId || !application.review) return application;
      return {
        ...application,
        status: params.reviewerOverallStatus ? reviewerWorkflowStatusFromCompliance(params.reviewerOverallStatus) : application.status,
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
          `Updated reviewer disposition for ${applicationNumberForId(snapshot, params.applicationId)}.`,
          { applicationId: params.applicationId, applicationNumber: applicationNumberForId(snapshot, params.applicationId), reviewerOverallStatus: params.reviewerOverallStatus }
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
    const applicationNumber = applicationNumberForNewApplication(snapshot, application);
    return {
      ...snapshot,
      activeApplicationId: application.id,
      applications: [application, ...snapshot.applications],
      auditEvents: [
        createAudit(
          `audit-${Date.now()}`,
          params.submitter || "Applicant",
          "applicant",
          "application.upload",
          "applications",
          `Created one-image manual application ${applicationNumber}.`,
          { applicationId: application.id, applicationNumber }
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
}): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const application = createApplicantApplication(params);
    const applicationNumber = applicationNumberForNewApplication(snapshot, application);
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
          `Saved draft application ${applicationNumber} with ${params.images.length} label image${params.images.length === 1 ? "" : "s"}.`,
          { applicationId: application.id, applicationNumber, imageCount: params.images.length }
        ),
        ...snapshot.auditEvents
      ]
    };
  });
}

export function autosaveApplicantDraft(params: {
  applicationId?: string;
  expectedFields: ExpectedFields;
  images: LabelImage[];
  submitter?: string;
  notes?: string;
}): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const existing = params.applicationId
      ? snapshot.applications.find((application) => application.id === params.applicationId && ["DRAFT", "READY_TO_SUBMIT"].includes(application.status))
      : undefined;
    const now = new Date().toISOString();
    if (!existing) {
      const application = createApplicantApplication({
        expectedFields: params.expectedFields,
        images: params.images,
        submitter: params.submitter,
        notes: params.notes,
        description: "Autosaved applicant draft."
      });
      const applicationNumber = applicationNumberForNewApplication(snapshot, application);
      return {
        ...snapshot,
        activeApplicationId: application.id,
        applications: [application, ...snapshot.applications],
        auditEvents: [
          createAudit(
            `audit-${Date.now()}`,
            params.submitter || "Applicant",
            "applicant",
            "application.autosave_draft",
            "applications",
            `Autosaved draft application ${applicationNumber}.`,
            { applicationId: application.id, applicationNumber, imageCount: params.images.length }
          ),
          ...snapshot.auditEvents
        ]
      };
    }
    const nextTitle = params.expectedFields.brandName ? `${params.expectedFields.brandName} application` : existing.title;
    return {
      ...snapshot,
      activeApplicationId: existing.id,
      applications: snapshot.applications.map((application) =>
        application.id === existing.id
          ? {
              ...application,
              title: nextTitle,
              expectedFields: params.expectedFields,
              images: params.images,
              submitter: params.submitter || application.submitter,
              updatedAt: now,
              metadata: {
                ...application.metadata,
                notes: params.notes
              }
            }
          : application
      )
    };
  });
}

export function deleteApplicantDraft(applicationId: string, actor = "Applicant"): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const application = snapshot.applications.find((candidate) => candidate.id === applicationId);
    if (!application) throw new Error(`Application ${applicationId} was not found.`);
    if (!["DRAFT", "READY_TO_SUBMIT"].includes(application.status)) {
      throw new Error("Only draft application packets can be deleted by applicants.");
    }
    const applications = snapshot.applications.filter((candidate) => candidate.id !== applicationId);
    return {
      ...snapshot,
      applications,
      jobs: snapshot.jobs.filter((job) => job.applicationId !== applicationId),
      activeApplicationId: snapshot.activeApplicationId === applicationId ? applications[0]?.id || "" : snapshot.activeApplicationId,
      auditEvents: [
        createAudit(`audit-${Date.now()}`, actor, "applicant", "application.delete_draft", "applications", `Deleted draft application ${applicationNumberFor(application)}.`, {
          applicationId,
          applicationNumber: applicationNumberFor(application)
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

export function archiveApplicantApplication(applicationId: string, actor = "Applicant"): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const now = new Date().toISOString();
    const application = snapshot.applications.find((candidate) => candidate.id === applicationId);
    if (!application) throw new Error(`Application ${applicationId} was not found.`);
    const archivedFromStatus = application.status === "ARCHIVED" ? application.metadata.archivedFromStatus || "DRAFT" : application.status;
    return {
      ...snapshot,
      activeApplicationId: applicationId,
      applications: snapshot.applications.map((candidate) =>
        candidate.id === applicationId
          ? {
              ...candidate,
              status: "ARCHIVED",
              updatedAt: now,
              metadata: {
                ...candidate.metadata,
                archivedFromStatus
              }
            }
          : candidate
      ),
      auditEvents: [
        createAudit(`audit-${Date.now()}`, actor, "applicant", "application.archive", "applications", `Archived application ${applicationNumberFor(application)}.`, {
          applicationId,
          applicationNumber: applicationNumberFor(application),
          archivedFromStatus
        }),
        ...snapshot.auditEvents
      ]
    };
  });
}

export function unarchiveApplicantApplication(applicationId: string, actor = "Applicant"): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const application = snapshot.applications.find((candidate) => candidate.id === applicationId);
    if (!application) throw new Error(`Application ${applicationId} was not found.`);
    const restoredStatus = application.metadata.archivedFromStatus && application.metadata.archivedFromStatus !== "ARCHIVED" ? application.metadata.archivedFromStatus : "DRAFT";
    return {
      ...snapshot,
      activeApplicationId: applicationId,
      applications: snapshot.applications.map((candidate) => {
        if (candidate.id !== applicationId) return candidate;
        const { archivedFromStatus: _archivedFromStatus, ...metadata } = candidate.metadata;
        return {
          ...candidate,
          status: restoredStatus,
          updatedAt: new Date().toISOString(),
          metadata
        };
      }),
      auditEvents: [
        createAudit(`audit-${Date.now()}`, actor, "applicant", "application.unarchive", "applications", `Restored archived application ${applicationNumberFor(application)}.`, {
          applicationId,
          applicationNumber: applicationNumberFor(application),
          restoredStatus
        }),
        ...snapshot.auditEvents
      ]
    };
  });
}

export function resubmitApplicantApplication(params: {
  applicationId: string;
  expectedFields: ExpectedFields;
  images: LabelImage[];
  submitter?: string;
  notes?: string;
  actor?: string;
}): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const applicationNumber = applicationNumberForId(snapshot, params.applicationId);
    return {
      ...snapshot,
      activeApplicationId: params.applicationId,
      applications: snapshot.applications.map((application) =>
        application.id === params.applicationId
          ? {
              ...application,
              status: "RESUBMITTED",
              expectedFields: params.expectedFields,
              images: params.images.length ? params.images : application.images,
              submitter: params.submitter || application.submitter,
              updatedAt: new Date().toISOString(),
              metadata: {
                ...application.metadata,
                notes: params.notes
              }
            }
          : application
      ),
      auditEvents: [
        createAudit(
          `audit-${Date.now()}`,
          params.actor || params.submitter || "Applicant",
          "applicant",
          "application.resubmit",
          "applications",
          `Updated and resubmitted application ${applicationNumber}.`,
          { applicationId: params.applicationId, applicationNumber, imageCount: params.images.length }
        ),
        ...snapshot.auditEvents
      ]
    };
  });
}

export function requestApplicantCorrection(params: { applicationId: string; message: string; fields: string[]; actor?: string }): ConsoleSnapshot {
  if (!params.message.trim()) throw new Error("Correction requests require a message.");
  return updateSnapshot((snapshot) => {
    const applicationNumber = applicationNumberForId(snapshot, params.applicationId);
    return {
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
          `Requested applicant correction for ${applicationNumber}.`,
          { applicationId: params.applicationId, applicationNumber, fields: params.fields }
        ),
        ...snapshot.auditEvents
      ]
    };
  });
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
  return updateSnapshot((snapshot) => {
    const applicationNumber = applicationNumberForId(snapshot, applicationId);
    return {
      ...snapshot,
      activeApplicationId: applicationId,
      applications: snapshot.applications.map((application) =>
        application.id === applicationId ? { ...application, status, updatedAt: new Date().toISOString() } : application
      ),
      auditEvents: [
        createAudit(`audit-${Date.now()}`, actor, role, action, "applications", `${summary} (${applicationNumber})`, { applicationId, applicationNumber }),
        ...snapshot.auditEvents
      ]
    };
  });
}

function updateApplication(applicationId: string, updater: (application: ReviewApplication) => ReviewApplication): ConsoleSnapshot {
  return updateSnapshot((snapshot) => ({
    ...snapshot,
    applications: snapshot.applications.map((application) => (application.id === applicationId ? updater(application) : application))
  }));
}

function applyCompletedReview(params: {
  applicationId: string;
  review: ReviewResult;
  actor: string;
  role: UserRole;
  action: string;
  summary: string;
}): ConsoleSnapshot {
  return updateSnapshot((snapshot) => {
    const applicationNumber = applicationNumberForId(snapshot, params.applicationId);
    return {
      ...snapshot,
      applications: snapshot.applications.map((application) =>
        application.id === params.applicationId
          ? {
              ...application,
              review: params.review,
              status: reviewerWorkflowStatusFromCompliance(params.review.status),
              updatedAt: new Date().toISOString()
            }
          : application
      ),
      auditEvents: [
        createAudit(`audit-${Date.now()}`, params.actor, params.role, params.action, "reviews", params.summary, {
          applicationId: params.applicationId,
          applicationNumber,
          processingMode: params.review.mode,
          engine: "tesseract-js-browser"
        }),
        ...snapshot.auditEvents
      ]
    };
  });
}

function applyReviewerFieldDecision(field: ReviewField, status?: FieldStatus, reason?: string): ReviewField {
  const nextStatus = status ?? field.reviewerStatus;
  const nextReason = reason ?? field.reviewerReason;
  return {
    ...field,
    reviewerStatus: nextStatus,
    reviewerReason: nextReason
  };
}

function shouldProcessForReviewer(application: ReviewApplication): boolean {
  return !application.review && !["ARCHIVED", "WITHDRAWN"].includes(application.status);
}

function isReviewerClosedStatus(status: ApplicationStatus): boolean {
  return ["APPROVED", "CONDITIONALLY_APPROVED", "REJECTED"].includes(status);
}

function applicationNumberForId(snapshot: ConsoleSnapshot, applicationId: string): string {
  return applicationNumberFor(snapshot.applications.find((application) => application.id === applicationId));
}

function applicationNumberForNewApplication(snapshot: ConsoleSnapshot, application: ReviewApplication): string {
  const numbered = assignApplicationNumbers([application, ...snapshot.applications]);
  return applicationNumberFor(numbered.find((candidate) => candidate.id === application.id));
}

function fieldDecisionLabel(fieldId: string): string {
  const key = fieldId.split("-").at(-1) || fieldId;
  return fieldLabels[key as keyof ExpectedFields] || key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function updateSnapshot(updater: (snapshot: ConsoleSnapshot) => ConsoleSnapshot): ConsoleSnapshot {
  const next = annotateAuditApplicationNumbers(updater(getSnapshot()));
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
  if (hasRetiredSampleReferences(snapshot)) return createDemoSnapshot();
  const applications = snapshot.applications.map((application) => ({
    ...application,
    status: normalizeApplicationStatus(application.status),
    review: application.review
      ? {
          ...application.review,
          status: normalizeReviewStatus(application.review.status),
          reviewerOverallStatus: application.review.reviewerOverallStatus
            ? normalizeReviewStatus(application.review.reviewerOverallStatus)
            : undefined,
          fields: application.review.fields
            .filter((field) => !METADATA_ONLY_REVIEW_FIELDS.has(String(field.fieldKey)))
            .map((field) => ({
              ...field,
              status: normalizeReviewStatus(field.status),
              reviewerStatus: field.reviewerStatus ? normalizeReviewStatus(field.reviewerStatus) : undefined
            }))
        }
      : undefined
  }));
  return annotateAuditApplicationNumbers({
    ...snapshot,
    applications,
    jobs: snapshot.jobs || createAdminJobsForApplications(applications),
    adminSettings: { ...createDefaultAdminSettings(), ...(snapshot.adminSettings || {}) },
    benchmarkRuns: snapshot.benchmarkRuns || createDemoBenchmarkRuns()
  });
}

function hasRetiredSampleReferences(snapshot: ConsoleSnapshot): boolean {
  return snapshot.applications.some(
    (application) =>
      application.source === "sample" &&
      (application.id.includes("hollow-ridge") ||
        application.id.includes("riverlight") ||
        application.id.includes("sundaze") ||
        application.id.includes("arbor-hill") ||
        application.id.includes("estrella") ||
        application.title.toLowerCase().includes("hollow ridge") ||
        application.images.some((image) => RETIRED_SAMPLE_URL_PARTS.some((part) => image.url.includes(part))))
  );
}

function notify(): void {
  for (const listener of listeners) listener();
}

function summarizeFields(fields: ReviewField[]): ReviewStatus {
  if (fields.some((field) => (field.reviewerStatus || field.status) === "FAIL")) return "FAIL";
  if (fields.some((field) => (field.reviewerStatus || field.status) === "NEEDS_REVIEW")) return "NEEDS_REVIEW";
  return "PASS";
}
