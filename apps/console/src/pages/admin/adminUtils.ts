import type { AdminJob, AdminSettings, ConsoleSnapshot } from "../../domain/application/types";

export function adminMetrics(snapshot: ConsoleSnapshot) {
  const latestRun = snapshot.benchmarkRuns.find((run) => run.status !== "skipped") || snapshot.benchmarkRuns[0];
  const latestApplicationTime = Math.max(...snapshot.applications.map((application) => Date.parse(application.createdAt)), 0);
  const latestApplicationDay = latestApplicationTime ? new Date(latestApplicationTime).toISOString().slice(0, 10) : "";
  const applicationsToday = snapshot.applications.filter((application) => application.createdAt.startsWith(latestApplicationDay)).length;
  return {
    applicationsToday,
    submitted: snapshot.applications.filter((application) => ["SUBMITTED", "RESUBMITTED"].includes(application.status)).length,
    needsReview: snapshot.applications.filter((application) => ["IN_REVIEW", "NEEDS_CORRECTION", "APPLICANT_FIX_REQUIRED"].includes(application.status)).length,
    approved: snapshot.applications.filter((application) => ["APPROVED", "CONDITIONALLY_APPROVED"].includes(application.status)).length,
    rejected: snapshot.applications.filter((application) => application.status === "REJECTED").length,
    activeWorkers: snapshot.workers.filter((worker) => ["online", "busy", "calibrating"].includes(worker.status) && !worker.disabled).length,
    queueDepth: snapshot.jobs.filter((job) => ["queued", "retrying"].includes(job.status)).length,
    imagesPerMinute: latestRun?.imagesPerMinute || parseThroughput(snapshot.workers[0]?.throughput),
    p50OcrMs: latestRun?.p50OcrMs || Math.round(average(snapshot.jobs.map((job) => job.durationMs).filter(isNumber))),
    p95OcrMs: latestRun?.p95OcrMs || percentile(snapshot.jobs.map((job) => job.durationMs).filter(isNumber), 0.95),
    failedJobs: snapshot.jobs.filter((job) => job.status === "failed").length,
    storageUsedMb: Number((estimatedStorageBytes(snapshot) / 1024 / 1024).toFixed(1))
  };
}

export function estimatedStorageBytes(snapshot: ConsoleSnapshot): number {
  return snapshot.applications.reduce(
    (sum, application) => sum + application.images.reduce((imageSum, image) => imageSum + (image.sizeBytes || 512 * 1024), 0),
    0
  );
}

export function jobDuration(job: AdminJob): string {
  if (job.durationMs) return `${job.durationMs} ms`;
  if (job.startedAt) return "Running";
  return "Pending";
}

export function settingLabel(key: keyof AdminSettings): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>): void {
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const csv = [keys.join(","), ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown): string {
  const text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function parseThroughput(value = ""): number {
  const match = value.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], target: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * target))];
}

function isNumber(value: unknown): value is number {
  return typeof value === "number";
}
