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
    throw new Error(`Create is not implemented for backend resource ${resource}.`);
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
    return { data: await request(path, { method: method?.toUpperCase() || "GET", body: payload ? JSON.stringify(payload) : undefined }) };
  }
};

export const backendDataProvider = apiDataProvider;

async function listResource(resource: string): Promise<any[]> {
  switch (resource as ConsoleResourceName) {
    case "applications":
      return request("/api/applications");
    case "workers":
      return request("/api/workers");
    case "auditEvents":
      return request("/api/workers/events?limit=50");
    case "settings": {
      const [health, version] = await Promise.all([request("/api/health"), request("/api/version")]);
      return [
        { id: "health", key: "health", value: health, updatedAt: new Date().toISOString() },
        { id: "version", key: "version", value: version, updatedAt: new Date().toISOString() }
      ];
    }
    case "applicationVersions":
    case "labelAssets":
    case "reviews":
    case "reviewDecisions":
    case "correctionRequests":
    case "users":
    case "jobs":
    case "reports":
    case "fixtures":
    case "benchmarks":
      return [];
    default:
      return [];
  }
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
