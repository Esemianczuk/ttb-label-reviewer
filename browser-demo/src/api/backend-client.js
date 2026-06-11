import { STATUS } from '../validation/status.js';

export const DEFAULT_BACKEND_URL = 'http://localhost:8000';
export const BACKEND_SESSION_STORAGE_KEY = 'ttb-reviewer-session-id';
export const BACKEND_URL_STORAGE_KEY = 'ttb-reviewer-backend-url';

const COMPLETE_REVIEW_STATUSES = new Set(['pass', 'fail', 'pass_with_warnings', 'needs_review', 'completed']);
const TERMINAL_ERROR_STATUSES = new Set(['failed', 'cancelled']);
const demoAuthCache = new Map();

export function getStoredBackendUrl(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(BACKEND_URL_STORAGE_KEY) || DEFAULT_BACKEND_URL;
  } catch {
    return DEFAULT_BACKEND_URL;
  }
}

export function storeBackendUrl(url, storage = globalThis.localStorage) {
  try {
    storage?.setItem(BACKEND_URL_STORAGE_KEY, normalizeBackendUrl(url));
  } catch {
    // The app can run without persistent storage.
  }
}

export function getOrCreateSessionId(storage = globalThis.localStorage) {
  try {
    const existing = storage?.getItem(BACKEND_SESSION_STORAGE_KEY);
    if (existing) return existing;
    const next = `browser-${crypto.randomUUID()}`;
    storage?.setItem(BACKEND_SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return `browser-${crypto.randomUUID()}`;
  }
}

export function normalizeBackendUrl(url = DEFAULT_BACKEND_URL) {
  const value = String(url || '').trim() || DEFAULT_BACKEND_URL;
  return value.replace(/\/+$/, '');
}

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeout),
  };
}

async function requestJson(path, { backendUrl, sessionId, method = 'GET', body, signal, authRole = 'applicant' } = {}) {
  const headers = { Accept: 'application/json' };
  if (sessionId) headers['X-Session-Id'] = sessionId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (authRole) headers.Authorization = `Bearer ${await getDemoToken({ backendUrl, role: authRole, signal })}`;
  const response = await fetch(`${normalizeBackendUrl(backendUrl)}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }
  return response.json();
}

async function responseErrorMessage(response) {
  try {
    const payload = await response.json();
    return payload.detail || payload.message || `Backend returned HTTP ${response.status}.`;
  } catch {
    return `Backend returned HTTP ${response.status}.`;
  }
}

export async function checkBackendHealth(backendUrl, { timeoutMs = 1400 } = {}) {
  const timeout = timeoutSignal(timeoutMs);
  try {
    return await requestJson('/api/health', { backendUrl, signal: timeout.signal, authRole: null });
  } finally {
    timeout.cancel();
  }
}

export async function fetchClusterSnapshot(backendUrl, { sessionId } = {}) {
  const [workers, events, clusterStatus] = await Promise.all([
    requestJson('/api/workers', { backendUrl, sessionId, authRole: 'admin' }),
    requestJson('/api/workers/events?limit=20', { backendUrl, sessionId, authRole: 'admin' }),
    requestJson('/api/cluster/status', { backendUrl, sessionId, authRole: 'admin' }).catch(() => null),
  ]);
  return { workers, events, clusterStatus };
}

export async function createRemoteApplication({ backendUrl, sessionId, expected, application }) {
  return requestJson('/api/applications', {
    backendUrl,
    sessionId,
    method: 'POST',
    body: {
      applicationId: expected.applicationId || application.packetId || undefined,
      source: application.mode === 'samples' ? 'sample' : 'upload',
      expectedFields: {
        productType: expected.productType || 'unknown',
        brandName: expected.brandName || '',
        classType: expected.classType || '',
        alcoholContent: expected.alcoholContent || '',
        netContents: expected.netContents || '',
        governmentWarningRequired: Boolean(expected.governmentWarningRequired),
        producerName: expected.producerName || undefined,
        countryOfOrigin: expected.countryOfOrigin || undefined,
        applicationId: expected.applicationId || undefined,
        labelId: expected.labelId || undefined,
      },
      metadata: {
        createdAt: new Date().toISOString(),
        notes: application.title || '',
        ttbId: expected.applicationId || undefined,
      },
    },
  });
}

export async function uploadRemoteImage({ backendUrl, sessionId, applicationId, image, blob }) {
  const formData = new FormData();
  formData.set('role', image.role || 'cola_sheet');
  formData.set('file', blob, image.name || 'application-image.png');
  const response = await fetch(`${normalizeBackendUrl(backendUrl)}/api/applications/${applicationId}/images`, {
    method: 'POST',
    headers: {
      ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
      Authorization: `Bearer ${await getDemoToken({ backendUrl, role: 'applicant' })}`,
    },
    body: formData,
  });
  if (!response.ok) throw new Error(await responseErrorMessage(response));
  return response.json();
}

export async function getDemoToken({ backendUrl, role = 'applicant', signal } = {}) {
  const key = `${normalizeBackendUrl(backendUrl)}:${role}`;
  const cached = demoAuthCache.get(key);
  if (cached && Date.parse(cached.expiresAt) - Date.now() > 60_000) return cached.token;

  const response = await fetch(`${normalizeBackendUrl(backendUrl)}/api/auth/demo-login`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role }),
    signal,
  });
  if (!response.ok) throw new Error(await responseErrorMessage(response));
  const payload = await response.json();
  demoAuthCache.set(key, { token: payload.token, expiresAt: payload.expiresAt });
  return payload.token;
}

export async function startRemoteReview({ backendUrl, sessionId, applicationId, mode }) {
  return requestJson(`/api/applications/${applicationId}/review`, {
    backendUrl,
    sessionId,
    method: 'POST',
    body: {
      mode: mode === 'cluster' ? 'distributed' : 'backend',
      priority: mode === 'cluster' ? 80 : 100,
    },
  });
}

export async function getRemoteReview({ backendUrl, sessionId, reviewId }) {
  return requestJson(`/api/reviews/${reviewId}`, { backendUrl, sessionId });
}

export async function waitForRemoteReview({
  backendUrl,
  sessionId,
  reviewId,
  signal,
  timeoutMs = 120000,
  intervalMs = 1000,
  onPoll,
}) {
  const startedAt = performance.now();
  let lastStatus = '';
  while (performance.now() - startedAt < timeoutMs) {
    if (signal?.aborted) throw new DOMException('Review cancelled.', 'AbortError');
    const review = await getRemoteReview({ backendUrl, sessionId, reviewId });
    if (review.status !== lastStatus) {
      lastStatus = review.status;
      onPoll?.(review);
    }
    const normalizedStatus = String(review.status || '').toLowerCase();
    if (COMPLETE_REVIEW_STATUSES.has(normalizedStatus) && review.result) return review;
    if (TERMINAL_ERROR_STATUSES.has(normalizedStatus)) {
      throw new Error(`Backend review ${normalizedStatus}.`);
    }
    await sleep(intervalMs, signal);
  }
  throw new Error('Backend review is still queued. Leave the backend running with at least one worker, or switch to Browser Only.');
}

export function connectSessionStream({ backendUrl, sessionId, onMessage }) {
  if (typeof WebSocket === 'undefined') return null;
  const wsUrl = normalizeBackendUrl(backendUrl).replace(/^http/i, 'ws');
  const socket = new WebSocket(`${wsUrl}/api/ws/sessions/${encodeURIComponent(sessionId)}`);
  socket.addEventListener('message', (event) => {
    try {
      onMessage?.(JSON.parse(event.data));
    } catch {
      // Ignore malformed socket messages.
    }
  });
  socket.addEventListener('open', () => {
    socket.send('frontend-ready');
  });
  return socket;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Review cancelled.', 'AbortError'));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(new DOMException('Review cancelled.', 'AbortError'));
      },
      { once: true },
    );
  });
}

function mapStatus(status) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'NOT_APPLICABLE' || normalized === 'COMPLETED') return STATUS.PASS;
  return STATUS[normalized] || normalized || STATUS.NEEDS_REVIEW;
}

function fieldLabel(key = '') {
  return String(key)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function remoteReviewToFrontendReview(remoteReview, { expected, images, application, processingMode, startedAt }) {
  const result = remoteReview.result || {};
  const totalMs = result.timings?.totalMs ?? (startedAt ? Math.max(0, Math.round(performance.now() - startedAt)) : 0);
  const files = images.map((image, index) => ({
    ...image,
    ocrResult: image.ocrResult || {
      engine: result.enginesUsed?.[0]?.displayName || result.files?.[index]?.engine || 'backend-worker',
      processingTimeMs: Math.round((result.timings?.ocrMs || totalMs || 0) / Math.max(images.length, 1)),
      rawText: result.combinedText || result.files?.[index]?.text || '',
      source: processingMode === 'cluster' ? 'cluster-backend' : 'local-backend',
      preprocessingNotes: [`Processed by ${processingMode === 'cluster' ? 'cluster workers' : 'local backend'}.`],
      variants: [],
    },
  }));
  const fields = (result.fields || []).map((field) => {
    const status = mapStatus(field.status);
    return {
      fieldKey: field.fieldKey,
      field: field.field || fieldLabel(field.fieldKey),
      expected: field.expected ?? '',
      extracted: field.extracted ?? '',
      status,
      severity: field.severity || 'warning',
      confidence: Number.isFinite(field.confidence) ? field.confidence : null,
      reason: field.reason || 'Backend worker completed this field review.',
      evidence: field.evidence?.[0] || field.evidence || null,
      evidenceCrops: field.evidenceCrops || [],
    };
  });

  return {
    ...result,
    id: result.id || remoteReview.id,
    mode: processingMode === 'cluster' ? 'cluster' : 'backend',
    overallStatus: mapStatus(result.overallStatus || remoteReview.status),
    fields,
    files,
    expectedApplication: expected,
    application,
    backendReviewId: remoteReview.id,
  };
}
