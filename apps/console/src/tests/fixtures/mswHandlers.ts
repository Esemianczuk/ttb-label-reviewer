import { http, HttpResponse } from "msw";

export const backendHandlers = [
  http.get("http://127.0.0.1:8000/api/health", () =>
    HttpResponse.json({
      ok: true,
      database: "sqlite",
      assetRoot: "data/assets"
    })
  ),
  http.get("http://127.0.0.1:8000/api/workers", () =>
    HttpResponse.json([
      {
        id: "worker-msw",
        hostname: "mock-worker",
        platform: "test",
        arch: "x64",
        version: "test",
        status: "online",
        capabilities: { ocr: true, validation: true },
        calibration: {},
        activeJobs: 0,
        maxConcurrency: 1,
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      }
    ])
  )
];
