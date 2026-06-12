import { http, HttpResponse } from "msw";

export const backendHandlers = [
  http.get("http://127.0.0.1:8000/api/health", () =>
    HttpResponse.json({
      ok: true,
      database: "sqlite",
      assetRoot: "data/assets",
      staticDir: "apps/console/dist",
      staticReady: true,
      lanMode: false,
      warning: null
    })
  ),
  http.post("http://127.0.0.1:8000/api/auth/demo-login", async ({ request }) => {
    const body = (await request.json()) as { role?: "applicant" | "reviewer" | "admin" };
    const role = body.role || "reviewer";
    return HttpResponse.json({
      token: `ttb_demo_msw_${role}`,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      user: {
        id: `msw-${role}`,
        email: `${role}@example.local`,
        displayName: `MSW ${role}`,
        role,
        status: "active",
        organizationId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });
  }),
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
