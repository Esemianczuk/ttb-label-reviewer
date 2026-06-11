import { describe, expect, it, vi } from "vitest";
import { consoleResourceNames } from "../../resources";
import { healthApiHealthGet } from "../../api/generated/ttbApi";
import { apiDataProvider, setBackendUrl } from "../../providers/data/backendDataProvider";
import { browserDataProvider } from "../../providers/data/browserDataProvider";
import { providerForMode } from "../../providers/data/providerRegistry";
import { resetSnapshot } from "../../providers/data/browserStore";

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
    expect(providerForMode("cluster").key).toBe("api");
    expect(providerForMode("cluster").requiresBackend).toBe(true);
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

  it("maps admin operations to backend endpoints", async () => {
    setBackendUrl("http://127.0.0.1:8123");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "token-admin-provider", expiresAt: new Date(Date.now() + 3600_000).toISOString() }))
      .mockResolvedValueOnce(jsonResponse({ id: "admin.operations", key: "admin.operations", value: { maxConcurrency: 8 }, updatedAt: new Date().toISOString() }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await apiDataProvider.custom?.({
      url: "admin/settings",
      method: "post",
      payload: { maxConcurrency: 8 }
    });

    expect(response?.data).toEqual(expect.objectContaining({ key: "admin.operations" }));
    expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:8123/api/settings/admin.operations");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ value: { maxConcurrency: 8 } });
    setBackendUrl("http://127.0.0.1:8000");
  });

  it("exposes a generated Orval API client instead of the old placeholder", () => {
    expect(typeof healthApiHealthGet).toBe("function");
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
