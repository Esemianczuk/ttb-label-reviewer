const BACKEND_URL_KEY = "ttb-console-backend-url";
const ROLE_STORAGE_KEY = "ttb-console-role";
const SESSION_KEY = "ttb-console-session-id";
const SHARED_DEMO_SESSION_ID = "console-demo-session";
const authCache = new Map<string, { token: string; expiresAt: string }>();

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const target = absoluteUrl(url);
  const headers = new Headers(options.headers);
  headers.set("Accept", headers.get("Accept") || "application/json");
  headers.set("X-Session-Id", headers.get("X-Session-Id") || getClientSessionId());
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!target.pathname.endsWith("/api/auth/demo-login")) {
    const authHeader = await clientDemoAuthHeader();
    for (const [key, value] of Object.entries(authHeader)) headers.set(key, value);
  }

  const response = await fetch(target, {
    ...options,
    headers
  });
  const data = await parseResponseBody(response);
  if (!response.ok) {
    throw new Error(responseError(data, response.status));
  }
  return { data, status: response.status, headers: response.headers } as T;
}

function absoluteUrl(url: string): URL {
  if (/^https?:\/\//i.test(url)) return new URL(url);
  return new URL(url.startsWith("/") ? url : `/${url}`, getClientBackendUrl());
}

function getClientBackendUrl(): string {
  return window.localStorage.getItem(BACKEND_URL_KEY) || defaultBackendUrl();
}

function defaultBackendUrl(): string {
  const configured = import.meta.env.VITE_TTB_BACKEND_URL;
  if (configured) return configured;
  const origin = window.location.origin;
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
  return "http://127.0.0.1:8000";
}

function getClientSessionId(): string {
  const existing = window.localStorage.getItem(SESSION_KEY);
  if (existing && existing !== "local-dev-session" && existing !== SHARED_DEMO_SESSION_ID) return existing;
  const sessionId = createClientSessionId();
  window.localStorage.setItem(SESSION_KEY, sessionId);
  return sessionId;
}

function createClientSessionId(): string {
  if (typeof window.crypto?.randomUUID === "function") return `console-${window.crypto.randomUUID()}`;
  return `console-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getClientRole(): string {
  const stored = window.localStorage.getItem(ROLE_STORAGE_KEY);
  return stored === "applicant" || stored === "reviewer" || stored === "admin" ? stored : "reviewer";
}

async function clientDemoAuthHeader(): Promise<Record<string, string>> {
  const role = getClientRole();
  const cacheKey = `${getClientBackendUrl()}:${role}`;
  const cached = authCache.get(cacheKey);
  if (cached && Date.parse(cached.expiresAt) - Date.now() > 60_000) {
    return { Authorization: `Bearer ${cached.token}` };
  }
  const response = await fetch(`${getClientBackendUrl()}/api/auth/demo-login`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Session-Id": getClientSessionId()
    },
    body: JSON.stringify({ role })
  });
  const payload = (await parseResponseBody(response)) as { token: string; expiresAt: string };
  if (!response.ok) throw new Error(responseError(payload, response.status));
  authCache.set(cacheKey, payload);
  return { Authorization: `Bearer ${payload.token}` };
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return response.text();
}

function responseError(data: unknown, status: number): string {
  if (data && typeof data === "object" && "detail" in data) return String((data as { detail: unknown }).detail);
  if (data && typeof data === "object" && "message" in data) return String((data as { message: unknown }).message);
  return `API request failed with HTTP ${status}`;
}
