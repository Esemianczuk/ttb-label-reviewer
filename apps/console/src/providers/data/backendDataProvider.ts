import type { DataProvider } from "@refinedev/core";
import type { ConsoleResourceName } from "../../resources";
import { getStoredRole } from "../auth/authProvider";

const SESSION_KEY = "ttb-console-session-id";
const authCache = new Map<string, { token: string; expiresAt: string }>();

export function getBackendUrl(): string {
  return window.localStorage.getItem("ttb-console-backend-url") || import.meta.env.VITE_TTB_BACKEND_URL || "http://127.0.0.1:8000";
}

export function setBackendUrl(url: string): void {
  window.localStorage.setItem("ttb-console-backend-url", url.replace(/\/+$/, ""));
}

export function getSessionId(): string {
  const existing = window.localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const next = `console-${crypto.randomUUID()}`;
  window.localStorage.setItem(SESSION_KEY, next);
  return next;
}

export const apiDataProvider: DataProvider = {
  getList: async ({ resource }) => {
    const data = await listResource(resource);
    return { data, total: data.length };
  },
  getOne: async ({ resource, id }) => {
    if (resource === "applications") return { data: await request(`/api/applications/${id}`) };
    if (resource === "reviews") return { data: await request(`/api/reviews/${id}`) };
    if (resource === "workers") return { data: await request(`/api/workers/${id}`) };
    if (resource === "jobs") return { data: await request(`/api/jobs/${id}`) };
    throw new Error(`${resource} record ${id} is not available from backend mode.`);
  },
  create: async ({ resource, variables }) => {
    if (resource === "applications") {
      return { data: await request("/api/applications", { method: "POST", body: JSON.stringify(variables) }) };
    }
    throw new Error(`Create is not supported for backend resource ${resource}.`);
  },
  update: async ({ resource, id, variables }) => {
    if (resource === "applications" && (variables as any)?.transition) {
      return { data: await request(`/api/applications/${id}/transition`, { method: "POST", body: JSON.stringify(variables) }) };
    }
    throw new Error(`Update for ${resource}/${id} is handled by reviewer audit endpoints in this prototype.`);
  },
  deleteOne: async ({ id }) => ({ data: { id } as any }),
  getApiUrl: () => getBackendUrl(),
  custom: async ({ url, method, payload }) => {
    const path = String(url || "");
    const adminAction = await runAdminAction(path, payload);
    if (adminAction) return { data: adminAction };
    return { data: await request(path, { method: method?.toUpperCase() || "GET", body: payload ? JSON.stringify(payload) : undefined }) };
  }
};

export const backendDataProvider = apiDataProvider;

async function listResource(resource: string): Promise<any[]> {
  switch (resource as ConsoleResourceName) {
    case "applications":
      return request("/api/applications");
    case "reviews":
      return request("/api/reviews?limit=100");
    case "workers":
      return request("/api/workers");
    case "auditEvents":
      return request("/api/audit-events?limit=100");
    case "settings":
      return request("/api/settings");
    case "jobs":
      return request("/api/jobs?limit=100");
    case "benchmarks":
      return request("/api/admin/benchmarks/results");
    case "applicationVersions":
      return request("/api/admin/application-versions");
    case "labelAssets":
      return request("/api/admin/assets");
    case "reviewDecisions":
      return request("/api/admin/review-decisions");
    case "correctionRequests":
      return request("/api/admin/correction-requests");
    case "users":
      return request("/api/admin/users");
    case "reports":
      return request("/api/admin/reports");
    case "fixtures":
      return request("/api/admin/fixtures");
    default:
      throw new Error(`Backend provider does not expose resource ${resource}.`);
  }
}

async function runAdminAction(action: string, payload: any): Promise<any | null> {
  if (action === "admin/settings") {
    const settings = payload || {};
    return request("/api/settings/admin.operations", { method: "PATCH", body: JSON.stringify({ value: settings }) });
  }
  if (action === "admin/worker") {
    const workerId = encodeURIComponent(payload?.workerId || "");
    const workerAction = payload?.action;
    if (workerAction === "recalibrate") return request(`/api/workers/${workerId}/recalibrate`, { method: "POST" });
    if (["drain", "disable", "enable"].includes(workerAction)) return request(`/api/workers/${workerId}/${workerAction}`, { method: "POST" });
    throw new Error(`Unsupported worker action ${workerAction}.`);
  }
  if (action === "admin/job") {
    const jobId = encodeURIComponent(payload?.jobId || "");
    const jobAction = payload?.action;
    if (jobAction === "cancel") return request(`/api/jobs/${jobId}/cancel`, { method: "POST" });
    if (jobAction === "retry") return request(`/api/jobs/${jobId}/retry`, { method: "POST" });
    if (jobAction === "raise_priority") return request(`/api/jobs/${jobId}/raise-priority`, { method: "POST" });
    throw new Error(`Unsupported job action ${jobAction}.`);
  }
  if (action === "admin/benchmark") {
    return request("/api/admin/benchmarks/run", { method: "POST", body: JSON.stringify(payload || {}) });
  }
  if (action === "admin/purge-raw-images") return request("/api/admin/retention/purge-raw-images", { method: "POST" });
  if (action === "admin/purge-old-jobs") return request("/api/admin/retention/purge-old-jobs", { method: "POST" });
  if (action === "admin/delete-packet") {
    return request(`/api/admin/retention/delete-application/${encodeURIComponent(payload?.applicationId || "")}`, { method: "POST" });
  }
  if (action === "admin/purge-all") {
    return request("/api/admin/retention/purge-all-demo-data", { method: "POST" });
  }
  return null;
}

export async function request<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const authHeader = await demoAuthHeader();
  const response = await fetch(`${getBackendUrl()}${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      "X-Session-Id": getSessionId(),
      ...authHeader,
      ...(init.headers || {})
    }
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<T>;
}

export async function demoAuthHeader(): Promise<Record<string, string>> {
  const role = getStoredRole();
  const cacheKey = `${getBackendUrl()}:${role}`;
  const cached = authCache.get(cacheKey);
  if (cached && Date.parse(cached.expiresAt) - Date.now() > 60_000) {
    return { Authorization: `Bearer ${cached.token}` };
  }
  const response = await fetch(`${getBackendUrl()}/api/auth/demo-login`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ role })
  });
  if (!response.ok) throw new Error(await responseError(response));
  const payload = (await response.json()) as { token: string; expiresAt: string };
  authCache.set(cacheKey, payload);
  return { Authorization: `Bearer ${payload.token}` };
}

async function responseError(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    return payload.detail || payload.message || `Backend returned HTTP ${response.status}.`;
  } catch {
    return `Backend returned HTTP ${response.status}.`;
  }
}
