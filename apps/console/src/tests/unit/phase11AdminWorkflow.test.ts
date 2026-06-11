import { describe, expect, it } from "vitest";
import {
  autoReviewApplication,
  deleteApplicationPacket,
  getSnapshot,
  purgeOldJobs,
  purgeRawImages,
  resetSnapshot,
  runAdminBenchmark,
  updateAdminSettings,
  updateJobOperation,
  updateWorkerOperation
} from "../../providers/data/browserStore";
import { adminMetrics } from "../../pages/admin/adminUtils";

describe("phase 11 admin workflow", () => {
  it("persists operations settings in the browser snapshot", () => {
    resetSnapshot();
    updateAdminSettings({ preferredOcrEngine: "tesseract", maxConcurrency: 8, warningStrictness: "strict" });
    expect(getSnapshot().adminSettings.preferredOcrEngine).toBe("tesseract");
    expect(getSnapshot().adminSettings.maxConcurrency).toBe(8);
    expect(getSnapshot().auditEvents[0].action).toBe("settings.update");
  });

  it("updates worker state for recalibrate, drain, disable, and enable", () => {
    resetSnapshot();
    updateWorkerOperation({ workerId: "worker-fastapi-01", action: "recalibrate" });
    expect(getSnapshot().workers.find((worker) => worker.id === "worker-fastapi-01")?.status).toBe("calibrating");
    updateWorkerOperation({ workerId: "worker-fastapi-01", action: "drain" });
    expect(getSnapshot().workers.find((worker) => worker.id === "worker-fastapi-01")?.drainMode).toBe(true);
    updateWorkerOperation({ workerId: "worker-fastapi-01", action: "disable" });
    expect(getSnapshot().workers.find((worker) => worker.id === "worker-fastapi-01")?.disabled).toBe(true);
    updateWorkerOperation({ workerId: "worker-fastapi-01", action: "enable" });
    expect(getSnapshot().workers.find((worker) => worker.id === "worker-fastapi-01")?.disabled).toBe(false);
  });

  it("supports job retry, cancellation, and priority changes", () => {
    resetSnapshot();
    const jobId = getSnapshot().jobs[0].id;
    updateJobOperation({ jobId, action: "raise_priority" });
    expect(getSnapshot().jobs[0].priority).toBeGreaterThan(90);
    updateJobOperation({ jobId, action: "retry" });
    expect(getSnapshot().jobs[0].status).toBe("retrying");
    updateJobOperation({ jobId, action: "cancel" });
    expect(getSnapshot().jobs[0].status).toBe("cancelled");
  });

  it("records benchmark runs and dashboard metrics", () => {
    resetSnapshot();
    const before = getSnapshot().benchmarkRuns.length;
    runAdminBenchmark({ imageCount: 10, mode: "browser" });
    const snapshot = getSnapshot();
    expect(snapshot.benchmarkRuns).toHaveLength(before + 1);
    expect(adminMetrics(snapshot).imagesPerMinute).toBeGreaterThan(0);
    expect(snapshot.auditEvents[0].action).toBe("benchmark.run");
  });

  it("purges retention data and deletes application packets", () => {
    resetSnapshot();
    autoReviewApplication(getSnapshot().applications[0].id, "browser");
    purgeRawImages();
    expect(getSnapshot().applications.some((application) => application.review && application.images.length === 0)).toBe(true);
    purgeOldJobs();
    expect(getSnapshot().jobs.every((job) => !["completed", "failed", "cancelled"].includes(job.status))).toBe(true);
    const applicationId = getSnapshot().applications[0].id;
    deleteApplicationPacket(applicationId);
    expect(getSnapshot().applications.some((application) => application.id === applicationId)).toBe(false);
  });
});
