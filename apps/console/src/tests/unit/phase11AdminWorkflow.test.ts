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
import { normalizeBackendWorker } from "../../pages/admin/useAdminOperations";

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

  it("normalizes rich backend worker capability maps into dashboard-safe arrays", () => {
    const worker = normalizeBackendWorker({
      id: "eric-TRX50-85ca20cf",
      hostname: "eric-TRX50",
      platform: "linux",
      arch: "x86_64",
      status: "online",
      activeJobs: 0,
      maxConcurrency: 2,
      lastSeenAt: "2026-06-12T21:39:25.715017",
      capabilities: {
        cpuCount: 64,
        memory: { totalBytes: 134518153216 },
        network: { latencyMs: 15.6 },
        ocr: true,
        evidence_crop: true,
        validation: true,
        engines: {
          tesseract: { available: false, status: "unavailable" },
          null: { available: true, status: "ok" }
        },
        supportedJobTypes: ["ocr", "evidence_crop", "validation"],
        warmEngines: ["null"]
      },
      calibration: {
        engines: {
          null: {
            available: true,
            status: "ok",
            steadyStateMs: 0
          }
        }
      }
    });

    expect(worker.engines).toEqual(["fixture fallback only"]);
    expect(worker.capabilities).toEqual(expect.arrayContaining(["fixture fallback only", "ocr", "evidence_crop", "validation"]));
    expect(worker.cpu).toBe("64 CPU cores");
    expect(worker.ramGb).toBeGreaterThan(120);
    expect(worker.latencyMs).toBe(16);
  });

  it("hides fixture fallback when PaddleOCR is available", () => {
    resetSnapshot();
    const worker = normalizeBackendWorker({
      id: "worker-paddleocr",
      hostname: "cuda-host",
      platform: "linux",
      arch: "x86_64",
      status: "online",
      activeJobs: 0,
      maxConcurrency: 4,
      lastSeenAt: "2026-06-12T21:39:25.715017",
      capabilities: {
        cpuCount: 64,
        memory: { totalBytes: 134518153216 },
        accelerators: { cuda: { available: true, devices: [{ name: "RTX" }] }, appleMps: { available: false } },
        engineProfile: { preferredEngine: "paddleocr", tier: "custom_paddleocr_cuda" },
        engines: {
          paddleocr: { available: true, status: "ok" },
          easyocr: { available: true, status: "ok" },
          null: { available: true, status: "ok" }
        },
        supportedJobTypes: ["ocr", "evidence_crop", "validation"],
        warmEngines: ["paddleocr", "easyocr", "null"]
      },
      calibration: {
        engines: {
          paddleocr: { available: true, status: "ok", steadyStateMs: 650 },
          easyocr: { available: true, status: "ok", steadyStateMs: 800 },
          null: { available: true, status: "ok", steadyStateMs: 0 }
        }
      }
    });

    expect(worker.engines).toEqual(["PaddleOCR COLA (CUDA preferred)", "EasyOCR (CUDA preferred)"]);
    expect(worker.capabilities).not.toContain("null");
    expect(worker.gpu).toBe("CUDA");
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
