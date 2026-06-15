import type { DataProvider } from "@refinedev/core";
import type { ConsoleResourceName } from "../../resources";
import { getStoredRole } from "../auth/authProvider";

const SESSION_KEY = "ttb-console-session-id";
const SHARED_DEMO_SESSION_ID = "console-demo-session";
const authCache = new Map<string, { token: string; expiresAt: string }>();

export function getBackendUrl(): string {
  return window.localStorage.getItem("ttb-console-backend-url") || defaultBackendUrl();
}

function defaultBackendUrl(): string {
  const configured = import.meta.env.VITE_TTB_BACKEND_URL;
  if (configured) return configured;
  const origin = window.location.origin;
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
  return "http://127.0.0.1:8000";
}

export function setBackendUrl(url: string): void {
  window.localStorage.setItem("ttb-console-backend-url", url.replace(/\/+$/, ""));
}

export function getSessionId(): string {
  const existing = window.localStorage.getItem(SESSION_KEY);
  if (existing && existing !== "local-dev-session" && existing !== SHARED_DEMO_SESSION_ID) return existing;
  const sessionId = createConsoleSessionId();
  window.localStorage.setItem(SESSION_KEY, sessionId);
  return sessionId;
}

function createConsoleSessionId(): string {
  if (typeof window.crypto?.randomUUID === "function") return `console-${window.crypto.randomUUID()}`;
  return `console-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
  deleteOne: async ({ resource }) => {
    throw new Error(`Delete is not supported for backend resource ${resource}.`);
  },
  getApiUrl: () => getBackendUrl(),
  custom: async ({ url, method, payload }) => {
    const path = String(url || "").replace(/^\/+/, "");
    if (path === "reviews/auto") return { data: await createBackendReview(payload) };
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
    case "ocrModelStatus":
      return request("/api/admin/ocr-model-status");
    default:
      throw new Error(`Backend provider does not expose resource ${resource}.`);
  }
}

async function runAdminAction(action: string, payload: any): Promise<any | null> {
  if (action === "admin/benchmark") {
    return request("/api/admin/benchmarks/run", { method: "POST", body: JSON.stringify(payload || {}) });
  }
  if (action.startsWith("admin/")) {
    throw new Error("This admin console is read-only except for benchmark runs.");
  }
  return null;
}

async function createBackendReview(payload: any): Promise<any> {
  const applicationId = encodeURIComponent(String(payload?.applicationId || ""));
  if (!applicationId) throw new Error("Application ID is required to start backend review.");
  const review = await request(`/api/applications/${applicationId}/review`, {
    method: "POST",
    body: JSON.stringify({
      mode: "backend",
      priority: payload?.priority ?? 100,
      ocrStrategy: payload?.ocrStrategy || "paddleocr_authoritative",
      primaryEngine: payload?.primaryEngine || "paddleocr",
      targetLatencyMs: payload?.targetLatencyMs ?? 5000,
      forceFreshOcr: payload?.forceFreshOcr ?? true
    })
  });
  return waitForBackendReview(review);
}

async function waitForBackendReview(initialReview: any, timeoutMs = 45_000): Promise<any> {
  const reviewId = initialReview?.id;
  if (!reviewId) return initialReview;
  const terminal = new Set(["completed", "complete", "pass", "fail", "warning", "needs_review", "not_found", "not_applicable", "pass_with_warnings"]);
  const failed = new Set(["failed", "cancelled", "canceled"]);
  const nonTerminalRunStatuses = new Set(["queued", "pending", "processing", "started", "running", "leased", "retrying"]);
  const started = Date.now();
  let lastReview = initialReview;
  while (Date.now() - started < timeoutMs) {
    lastReview = await request(`/api/reviews/${encodeURIComponent(reviewId)}`);
    const runStatus = String(lastReview?.runStatus || lastReview?.status || "").toLowerCase();
    if (failed.has(runStatus)) {
      throw new Error(`Backend review ${reviewId} ${runStatus}. Check the worker log for OCR errors.`);
    }
    if (lastReview?.result) return lastReview;
    if (terminal.has(runStatus) && !nonTerminalRunStatuses.has(runStatus)) return lastReview;
    await sleep(runStatus === "queued" || runStatus === "pending" ? 650 : 900);
  }
  throw new Error("Backend review did not finish within 45 seconds. Confirm the local PaddleOCR worker is running and healthy.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
      "Content-Type": "application/json",
      "X-Session-Id": getSessionId()
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
