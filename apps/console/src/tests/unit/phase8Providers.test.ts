import { describe, expect, it, vi } from "vitest";
import { consoleResourceNames } from "../../resources";
import { healthApiHealthGet } from "../../api/generated/ttbApi";
import { apiDataProvider, listBackendResourceAsRole, setBackendUrl } from "../../providers/data/backendDataProvider";
import { browserDataProvider } from "../../providers/data/browserDataProvider";
import { providerForMode } from "../../providers/data/providerRegistry";
import { applyBackendReviewResult, getSnapshot, resetSnapshot } from "../../providers/data/browserStore";

describe("phase 8 provider consolidation", () => {
  it("registers every phase-8 resource in the browser provider", async () => {
    resetSnapshot();
    for (const resource of consoleResourceNames) {
      const response = await browserDataProvider.getList({ resource });
      expect(Array.isArray(response.data)).toBe(true);
      expect(typeof response.total).toBe("number");
    }
  });

  it("maps processing modes to the correct provider behavior", () => {
    expect(providerForMode("browser").key).toBe("browser");
    expect(providerForMode("browser").requiresBackend).toBe(false);
    expect(providerForMode("backend").key).toBe("api");
    expect(providerForMode("backend").requiresBackend).toBe(true);
  });

  it("calls FastAPI endpoints through the API data provider", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "token-api-provider", expiresAt: new Date(Date.now() + 3600_000).toISOString() }))
      .mockResolvedValueOnce(jsonResponse([{ id: "api-application", status: "DRAFT" }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await apiDataProvider.getList({ resource: "applications" });

    expect(response.data).toEqual([{ id: "api-application", status: "DRAFT" }]);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/api/auth/demo-login", expect.any(Object));
    expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:8000/api/applications");
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-api-provider"
        })
      })
    );
  });

  it("keeps backend admin provider destructive actions read-only", async () => {
    setBackendUrl("http://127.0.0.1:8123");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiDataProvider.custom?.({
      url: "admin/settings",
      method: "post",
      payload: { maxConcurrency: 8 }
    })).rejects.toThrow("read-only");

    await expect(apiDataProvider.custom?.({
      url: "admin/purge-all",
      method: "post",
      payload: {}
    })).rejects.toThrow("read-only");

    expect(fetchMock).not.toHaveBeenCalled();
    setBackendUrl("http://127.0.0.1:8000");
  });

  it("maps admin benchmark runs to the backend benchmark endpoint", async () => {
    setBackendUrl("http://127.0.0.1:8123");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "token-admin-provider", expiresAt: new Date(Date.now() + 3600_000).toISOString() }))
      .mockResolvedValueOnce(jsonResponse({ id: "bench-1", imageCount: 1, status: "completed" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await apiDataProvider.custom?.({
      url: "admin/benchmark",
      method: "post",
      payload: { imageCount: 1 }
    });

    expect(response?.data).toEqual(expect.objectContaining({ id: "bench-1" }));
    expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:8123/api/admin/benchmarks/run");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ imageCount: 1 });
    setBackendUrl("http://127.0.0.1:8000");
  });

  it("maps backend review automation to the application review endpoint", async () => {
    window.localStorage.setItem("ttb-console-role", "reviewer");
    setBackendUrl("http://127.0.0.1:8127");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "token-review-provider", expiresAt: new Date(Date.now() + 3600_000).toISOString() }))
      .mockResolvedValueOnce(jsonResponse({ id: "review-app-backend-1", applicationId: "app-backend-1", mode: "backend", status: "queued", runStatus: "QUEUED", canonicalStatus: "NEEDS_REVIEW", result: null }))
      .mockResolvedValueOnce(jsonResponse({
        id: "review-app-backend-1",
        applicationId: "app-backend-1",
        mode: "backend",
        status: "queued",
        runStatus: "QUEUED",
        canonicalStatus: "NEEDS_REVIEW",
        result: null
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: "review-app-backend-1",
        applicationId: "app-backend-1",
        mode: "backend",
        status: "pass",
        runStatus: "COMPLETED",
        canonicalStatus: "PASS",
        result: { overallStatus: "PASS", fields: [] }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await apiDataProvider.custom?.({
      url: "reviews/auto",
      method: "post",
      payload: { applicationId: "app-backend-1", mode: "backend" }
    });

    expect(response?.data).toEqual(expect.objectContaining({ applicationId: "app-backend-1", mode: "backend" }));
    expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:8127/api/applications/app-backend-1/review");
    expect(fetchMock.mock.calls[2][0]).toBe("http://127.0.0.1:8127/api/reviews/review-app-backend-1");
    expect(fetchMock.mock.calls[3][0]).toBe("http://127.0.0.1:8127/api/reviews/review-app-backend-1");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
      mode: "backend",
      priority: 100,
      ocrStrategy: "paddleocr_authoritative",
      primaryEngine: "paddleocr",
      targetLatencyMs: 5000,
      forceFreshOcr: true
    });
    setBackendUrl("http://127.0.0.1:8000");
  });

  it("does not import empty backend reviews as local fallback evidence", () => {
    const snapshot = resetSnapshot();
    const applicationId = snapshot.applications[0].id;

    expect(() =>
      applyBackendReviewResult(applicationId, {
        id: "empty-backend-review",
        applicationId,
        mode: "backend",
        status: "queued",
        runStatus: "QUEUED",
        canonicalStatus: "NEEDS_REVIEW",
        result: null
      })
    ).toThrow(/without field evidence/i);
    expect(getSnapshot().applications.find((application) => application.id === applicationId)?.review).toBeUndefined();
  });

  it("reads benchmark JSON through the backend provider", async () => {
    window.localStorage.setItem("ttb-console-role", "admin");
    setBackendUrl("http://127.0.0.1:8124");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "token-benchmark-provider", expiresAt: new Date(Date.now() + 3600_000).toISOString() }))
      .mockResolvedValueOnce(jsonResponse([
        {
          id: "benchmark-json-1",
          label: "1 image backend benchmark",
          imageCount: 1,
          mode: "backend",
          status: "completed",
          workerId: "backend-local",
          workerChosen: "backend-local",
          engineUsed: "python-validator-fixture",
          totalMs: 420,
          averageMsPerImage: 420,
          p50OcrMs: 390,
          p95OcrMs: 510,
          imagesPerMinute: 142,
          queueMs: 8,
          validationMs: 2,
          failures: 0,
          createdAt: new Date().toISOString()
        }
      ]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await apiDataProvider.getList({ resource: "benchmarks" });

    expect(response.data[0]).toMatchObject({ id: "benchmark-json-1", engineUsed: "python-validator-fixture", queueMs: 8 });
    expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:8124/api/admin/benchmarks/results");
    setBackendUrl("http://127.0.0.1:8000");
  });

  it("keeps admin refresh auth stable when the visible role changes", async () => {
    window.localStorage.setItem("ttb-console-role", "applicant");
    setBackendUrl("http://127.0.0.1:8130");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "token-admin-explicit", expiresAt: new Date(Date.now() + 3600_000).toISOString() }))
      .mockResolvedValueOnce(jsonResponse([{ id: "worker-1", status: "online" }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await listBackendResourceAsRole("workers", "admin");

    expect(response).toEqual([{ id: "worker-1", status: "online" }]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ role: "admin" });
    expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:8130/api/workers");
    expect(fetchMock.mock.calls[1][1].headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer token-admin-explicit"
      })
    );
    setBackendUrl("http://127.0.0.1:8000");
  });

  it("does not silently return empty arrays for backend enterprise resources", async () => {
    window.localStorage.setItem("ttb-console-role", "admin");
    setBackendUrl("http://127.0.0.1:8126");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "token-enterprise-resources", expiresAt: new Date(Date.now() + 3600_000).toISOString() }))
      .mockResolvedValueOnce(jsonResponse([{ id: "version-1", applicationId: "app-1" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "asset-1", applicationId: "app-1" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "decision-1", reviewId: "review-1" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "correction-1", applicationId: "app-1" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "admin-user", role: "admin" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "report-1.json", reviewId: "review-1" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "fixture-1", manifest: "browser-demo/public/label-packets/manifest.json" }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiDataProvider.getList({ resource: "applicationVersions" })).resolves.toMatchObject({ total: 1 });
    await expect(apiDataProvider.getList({ resource: "labelAssets" })).resolves.toMatchObject({ total: 1 });
    await expect(apiDataProvider.getList({ resource: "reviewDecisions" })).resolves.toMatchObject({ total: 1 });
    await expect(apiDataProvider.getList({ resource: "correctionRequests" })).resolves.toMatchObject({ total: 1 });
    await expect(apiDataProvider.getList({ resource: "users" })).resolves.toMatchObject({ total: 1 });
    await expect(apiDataProvider.getList({ resource: "reports" })).resolves.toMatchObject({ total: 1 });
    await expect(apiDataProvider.getList({ resource: "fixtures" })).resolves.toMatchObject({ total: 1 });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "http://127.0.0.1:8126/api/auth/demo-login",
      "http://127.0.0.1:8126/api/admin/application-versions",
      "http://127.0.0.1:8126/api/admin/assets",
      "http://127.0.0.1:8126/api/admin/review-decisions",
      "http://127.0.0.1:8126/api/admin/correction-requests",
      "http://127.0.0.1:8126/api/admin/users",
      "http://127.0.0.1:8126/api/admin/reports",
      "http://127.0.0.1:8126/api/admin/fixtures"
    ]);
    setBackendUrl("http://127.0.0.1:8000");
  });

  it("runs backend benchmarks through the JSON-producing API", async () => {
    window.localStorage.setItem("ttb-console-role", "admin");
    setBackendUrl("http://127.0.0.1:8125");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "token-benchmark-run", expiresAt: new Date(Date.now() + 3600_000).toISOString() }))
      .mockResolvedValueOnce(jsonResponse([{ id: "benchmark-run-10", imageCount: 10, mode: "backend" }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await apiDataProvider.custom?.({
      url: "admin/benchmark",
      method: "post",
      payload: { imageCount: 10, mode: "backend", label: "10 image admin run" }
    });

    expect(response?.data).toEqual([{ id: "benchmark-run-10", imageCount: 10, mode: "backend" }]);
    expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:8125/api/admin/benchmarks/run");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ imageCount: 10, mode: "backend", label: "10 image admin run" });
    setBackendUrl("http://127.0.0.1:8000");
  });

  it("exposes a generated Orval API client", () => {
    expect(typeof healthApiHealthGet).toBe("function");
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
