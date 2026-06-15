import { describe, expect, it } from "vitest";
import {
  getSnapshot,
  resetSnapshot,
  runAdminBenchmark
} from "../../providers/data/browserStore";
import { canAccess } from "../../providers/access/permissionMatrix";
import { browserDataProvider } from "../../providers/data/browserDataProvider";
import { adminMetrics } from "../../pages/admin/adminUtils";
import { normalizeBackendWorker } from "../../pages/admin/useAdminOperations";

describe("phase 11 admin workflow", () => {
  it("keeps admin permissions observational except for benchmark runs", () => {
    expect(canAccess("admin", "workers", "list")).toBe(true);
    expect(canAccess("admin", "jobs", "show")).toBe(true);
    expect(canAccess("admin", "settings", "show")).toBe(true);
    expect(canAccess("admin", "benchmarks", "run")).toBe(true);

    expect(canAccess("admin", "workers", "disable")).toBe(false);
    expect(canAccess("admin", "workers", "drain")).toBe(false);
    expect(canAccess("admin", "jobs", "cancel")).toBe(false);
    expect(canAccess("admin", "jobs", "retry")).toBe(false);
    expect(canAccess("admin", "settings", "update")).toBe(false);
    expect(canAccess("admin", "settings", "purge")).toBe(false);
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
          paddleocr: { available: true, status: "ok" }
        },
        supportedJobTypes: ["ocr", "evidence_crop", "validation"],
        warmEngines: ["paddleocr"]
      },
      calibration: {
        engines: {
          paddleocr: {
            available: true,
            status: "ok",
            steadyStateMs: 900
          }
        }
      }
    });

    expect(worker.engines).toEqual(["PaddleOCR COLA"]);
    expect(worker.capabilities).toEqual(expect.arrayContaining(["ocr", "evidence_crop", "validation"]));
    expect(worker.cpu).toBe("64 CPU cores");
    expect(worker.ramGb).toBeGreaterThan(120);
    expect(worker.latencyMs).toBe(16);
  });

  it("hides non-production engines when PaddleOCR is available", () => {
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
          null: { available: true, status: "ok" }
        },
        supportedJobTypes: ["ocr", "evidence_crop", "validation"],
        warmEngines: ["paddleocr", "null"]
      },
      calibration: {
        engines: {
          paddleocr: { available: true, status: "ok", steadyStateMs: 650 },
          null: { available: true, status: "ok", steadyStateMs: 0 }
        }
      }
    });

    expect(worker.engines).toEqual(["PaddleOCR COLA (CUDA preferred)"]);
    expect(worker.capabilities).not.toContain("null");
    expect(worker.gpu).toBe("CUDA");
  });

  it("rejects hidden destructive admin actions in browser fallback mode", async () => {
    resetSnapshot();
    const before = getSnapshot();
    const custom = browserDataProvider.custom!;

    await expect(custom({ url: "admin/settings", method: "post", payload: { maxConcurrency: 1 } })).rejects.toThrow("read-only");
    await expect(custom({ url: "admin/worker", method: "post", payload: { workerId: "worker-1", action: "disable" } })).rejects.toThrow("read-only");
    await expect(custom({ url: "admin/job", method: "post", payload: { jobId: "job-1", action: "cancel" } })).rejects.toThrow("read-only");
    await expect(custom({ url: "admin/purge-all", method: "post", payload: {} })).rejects.toThrow("read-only");

    const after = getSnapshot();
    expect(after.applications).toHaveLength(before.applications.length);
    expect(after.jobs).toHaveLength(before.jobs.length);
    expect(after.adminSettings).toEqual(before.adminSettings);
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

});
