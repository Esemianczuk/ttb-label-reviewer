import { useCallback, useEffect, useMemo, useState } from "react";
import type { DataProvider } from "@refinedev/core";
import type { AdminJob, AdminSettings, AuditEvent, BenchmarkRun, ConsoleSnapshot, ProcessingMode, ReviewApplication, WorkerSnapshot } from "../../domain/application/types";
import { createDefaultAdminSettings } from "../../domain/application/demoData";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { useProcessingModeContext } from "../../providers/processing/ProcessingModeProvider";

type AdminActionPayload = Record<string, unknown>;
type AdminAction = "admin/settings" | "admin/worker" | "admin/job" | "admin/benchmark" | "admin/purge-raw-images" | "admin/purge-old-jobs" | "admin/delete-packet" | "admin/purge-all";

const adminResources = ["applications", "workers", "jobs", "auditEvents", "settings", "benchmarks"] as const;

export function useAdminOperations() {
  const { snapshot: localSnapshot, activeApplication } = useConsoleStore();
  const { dataProvider, mode, backendUnavailable } = useProcessingModeContext();
  const [remoteSnapshot, setRemoteSnapshot] = useState<Partial<ConsoleSnapshot>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (mode === "browser" || backendUnavailable) {
      setRemoteSnapshot({});
      return;
    }
    setLoading(true);
    try {
      const entries = await Promise.all(
        adminResources.map(async (resource) => {
          const response = await dataProvider.getList({ resource });
          return [resource, response.data] as const;
        })
      );
      setRemoteSnapshot(normalizeRemoteSnapshot(localSnapshot, Object.fromEntries(entries)));
    } finally {
      setLoading(false);
    }
  }, [backendUnavailable, dataProvider, localSnapshot, mode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAction = useCallback(
    async (action: AdminAction, payload: AdminActionPayload = {}) => {
      if (!dataProvider.custom) throw new Error(`The active data provider does not support ${action}.`);
      await dataProvider.custom({ url: action, method: "post", payload });
      await refresh();
    },
    [dataProvider, refresh]
  );

  const snapshot = useMemo(
    () => ({
      ...localSnapshot,
      ...remoteSnapshot,
      adminSettings: remoteSnapshot.adminSettings || localSnapshot.adminSettings,
      activeApplicationId: localSnapshot.activeApplicationId,
      processingMode: localSnapshot.processingMode
    }),
    [localSnapshot, remoteSnapshot]
  );

  return { snapshot, activeApplication, loading, mode, backendUnavailable, runAction, refresh };
}

function normalizeRemoteSnapshot(base: ConsoleSnapshot, resources: Record<string, any[]>): Partial<ConsoleSnapshot> {
  return {
    applications: resources.applications?.map(normalizeApplication).filter((application): application is ReviewApplication => Boolean(application)) || base.applications,
    workers: resources.workers?.map(normalizeWorker) || base.workers,
    jobs: resources.jobs?.map(normalizeJob) || base.jobs,
    auditEvents: resources.auditEvents?.map(normalizeAuditEvent) || base.auditEvents,
    adminSettings: normalizeSettings(resources.settings),
    benchmarkRuns: resources.benchmarks?.map(normalizeBenchmark) || base.benchmarkRuns
  };
}

function normalizeApplication(row: any): ReviewApplication | null {
  if (!row) return null;
  if (row.expectedFields && row.images) return row as ReviewApplication;
  const expectedFields = row.expectedFields || {};
  return {
    id: row.id,
    title: expectedFields.brandName || row.applicationId || row.id,
    source: row.source || "manual",
    status: (row.canonicalStatus || row.status || "SUBMITTED").toUpperCase(),
    expectedOutcome: "NEEDS_REVIEW",
    expectedFields: {
      productType: expectedFields.productType || "unknown",
      brandName: expectedFields.brandName || "Unknown Brand",
      fancifulName: expectedFields.fancifulName,
      classType: expectedFields.classType || "Unknown Class",
      alcoholContent: expectedFields.alcoholContent || "unknown",
      netContents: expectedFields.netContents || "unknown",
      governmentWarningRequired: Boolean(expectedFields.governmentWarningRequired),
      producerName: expectedFields.producerName,
      countryOfOrigin: expectedFields.countryOfOrigin,
      applicationId: expectedFields.applicationId || row.applicationId,
      labelId: expectedFields.labelId
    },
    images: [],
    submitter: row.ownerUserId || "Backend applicant",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    metadata: row.metadata || {}
  } as ReviewApplication;
}

function normalizeWorker(row: any): WorkerSnapshot {
  if (Array.isArray(row.capabilities)) return row as WorkerSnapshot;
  const capabilities = Object.entries(row.capabilities || {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key);
  const calibration = row.calibration || {};
  return {
    id: row.id,
    hostname: row.hostname,
    platform: row.platform || calibration.platform || "backend",
    os: row.platform || calibration.os || "backend",
    arch: row.arch,
    cpu: calibration.cpu || "reported CPU unavailable",
    ramGb: calibration.ramGb,
    gpu: calibration.gpu || (capabilities.includes("cuda") ? "CUDA" : capabilities.includes("mps") ? "MPS" : undefined),
    status: row.status || "online",
    activeJobs: row.activeJobs || 0,
    maxConcurrency: row.maxConcurrency || 1,
    capabilities,
    engines: calibration.engines || capabilities,
    latencyMs: calibration.latencyMs || calibration.ocrMs || 0,
    throughput: calibration.throughput || `${Math.max(1, Math.round(60000 / Math.max(1, calibration.ocrMs || 650)))} images/min`,
    avgMsPerImage: calibration.avgMsPerImage || calibration.ocrMs,
    drainMode: Boolean(calibration.drainMode),
    disabled: Boolean(calibration.disabled || row.status === "disabled"),
    lastSeenAt: row.lastSeenAt
  };
}

function normalizeJob(row: any): AdminJob {
  if (row.type) return row as AdminJob;
  const durationMs = row.startedAt && row.completedAt ? Math.max(0, Date.parse(row.completedAt) - Date.parse(row.startedAt)) : undefined;
  return {
    id: row.id,
    applicationId: row.applicationId,
    type: row.jobType || "ocr",
    status: row.status || "queued",
    priority: row.priority || 100,
    workerId: row.assignedWorkerId || undefined,
    engine: row.requiredCapabilities?.engine || row.payload?.engine || row.jobType || "backend",
    attempts: row.attempts || 0,
    createdAt: row.createdAt,
    startedAt: row.startedAt || undefined,
    completedAt: row.completedAt || undefined,
    durationMs,
    schedulerReason: row.payload?.schedulerReason || row.error || "Backend scheduler state"
  };
}

function normalizeAuditEvent(row: any): AuditEvent {
  if (row.action) return row as AuditEvent;
  return {
    id: row.id,
    createdAt: row.createdAt,
    actor: row.actorUserId || "Backend",
    role: row.actorRole || "admin",
    action: row.eventType || "event",
    resource: row.entityType || "system",
    summary: row.summary,
    metadata: {
      ...(row.metadata || {}),
      entityId: row.entityId,
      before: row.before,
      after: row.after
    }
  };
}

function normalizeSettings(rows?: any[]): AdminSettings {
  const settings = createDefaultAdminSettings();
  for (const row of rows || []) {
    if (row.key === "admin.operations" && row.value && typeof row.value === "object") {
      Object.assign(settings, row.value);
    } else if (row.key in settings) {
      (settings as any)[row.key] = row.value;
    }
  }
  return settings;
}

function normalizeBenchmark(row: any): BenchmarkRun {
  return row as BenchmarkRun;
}
