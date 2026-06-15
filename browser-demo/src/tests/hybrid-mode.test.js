import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloneExpectedFields, createInitialState } from '../app-state.js';
import { checkBackendHealth, createRemoteApplication, fetchWorkerSnapshot, remoteReviewToFrontendReview } from '../api/backend-client.js';
import { renderApp } from '../ui/render.js';
import { STATUS } from '../validation/status.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('hybrid backend client', () => {
  it('checks backend health against the configured URL', async () => {
    const fetchMock = vi.fn(async (url) => {
      expect(url).toBe('http://localhost:8000/api/health');
      return {
        ok: true,
        json: async () => ({ ok: true, database: 'sqlite', assetRoot: '/tmp/assets' }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(checkBackendHealth('http://localhost:8000/')).resolves.toMatchObject({ ok: true });
  });

  it('logs in as the demo applicant before mutating backend applications', async () => {
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === 'http://backend.test/api/auth/demo-login') {
        expect(JSON.parse(init.body)).toEqual({ role: 'applicant' });
        return {
          ok: true,
          json: async () => ({ token: 'ttb_demo_applicant_test', expiresAt: new Date(Date.now() + 3600_000).toISOString() }),
        };
      }
      expect(url).toBe('http://backend.test/api/applications');
      expect(init.headers.Authorization).toBe('Bearer ttb_demo_applicant_test');
      expect(init.headers['X-Session-Id']).toBe('browser-test');
      return {
        ok: true,
        json: async () => ({ id: 'app-1', status: 'created' }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createRemoteApplication({
        backendUrl: 'http://backend.test',
        sessionId: 'browser-test',
        expected: {
          productType: 'distilled_spirits',
          brandName: 'Hollow Ridge',
          classType: 'Bourbon Whiskey',
          alcoholContent: '45% alc/vol',
          netContents: '750 mL',
          governmentWarningRequired: true,
        },
        application: { packetId: 'packet-1', mode: 'samples', title: 'Hollow Ridge' },
      }),
    ).resolves.toMatchObject({ id: 'app-1' });
  });

  it('uses admin auth for backend worker telemetry', async () => {
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === 'http://backend.test/api/auth/demo-login') {
        expect(JSON.parse(init.body)).toEqual({ role: 'admin' });
        return {
          ok: true,
          json: async () => ({ token: 'ttb_demo_admin_test', expiresAt: new Date(Date.now() + 3600_000).toISOString() }),
        };
      }
      expect(init.headers.Authorization).toBe('Bearer ttb_demo_admin_test');
      if (url.endsWith('/api/workers')) return { ok: true, json: async () => [] };
      if (url.endsWith('/api/workers/events?limit=20')) return { ok: true, json: async () => [] };
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchWorkerSnapshot('http://backend.test', { sessionId: 'browser-test' })).resolves.toMatchObject({
      workers: [],
      events: [],
    });
  });

  it('adapts backend review results to the browser reviewer shape', () => {
    const expected = cloneExpectedFields({
      brandName: 'Hollow Ridge',
      classType: 'Bourbon Whiskey',
      alcoholContent: '45% alc/vol',
      netContents: '750 mL',
      governmentWarningRequired: true,
    });
    const frontendReview = remoteReviewToFrontendReview(
      {
        id: 'review-1',
        status: 'pass',
        result: {
          overallStatus: 'PASS',
          fields: [
            {
              fieldKey: 'brandName',
              expected: 'Hollow Ridge',
              extracted: 'Hollow Ridge',
              status: 'PASS',
              severity: 'critical',
              confidence: 0.99,
              reason: 'Found by worker OCR.',
            },
          ],
          files: [{ engine: 'null' }],
          timings: { totalMs: 42, ocrMs: 20 },
          combinedText: 'Hollow Ridge',
        },
      },
      {
        expected,
        images: [{ id: 'image-1', name: 'front.png', url: '/front.png' }],
        application: { title: 'Hollow Ridge' },
        processingMode: 'backend',
      },
    );

    expect(frontendReview.overallStatus).toBe(STATUS.PASS);
    expect(frontendReview.fields[0].field).toBe('Brand Name');
    expect(frontendReview.files[0].ocrResult.source).toBe('local-backend');
  });
});

describe('hybrid dashboard rendering', () => {
  it('renders fake worker data and scheduler reasons for tests', () => {
    const state = createInitialState();
    state.processingMode = 'backend';
    state.backendStatus = 'online';
    state.backendMessage = 'Backend online at http://localhost:8000';
    state.backendSessionId = 'browser-test';
    state.backendWorkers = [
      {
        id: 'worker-bigbertha',
        hostname: 'bigbertha',
        platform: 'linux',
        arch: 'x86_64',
        status: 'online',
        activeJobs: 1,
        maxConcurrency: 2,
        lastSeenAt: new Date().toISOString(),
        capabilities: {
          cpuCount: 16,
          accelerators: { cuda: { available: true }, appleMps: { available: false } },
          engines: { null: { available: true }, tesseract: { available: true } },
        },
        calibration: { engines: { null: { ocrMs: 5 } } },
      },
    ];
    state.backendEvents = [
      {
        workerId: 'worker-bigbertha',
        eventType: 'job_claimed',
        payload: { assignment: { reason_codes: ['queued_job', 'available_worker'] } },
      },
    ];

    const html = renderApp(state);

    expect(html).toContain('Processing Mode');
    expect(html).toContain('bigbertha');
    expect(html).toContain('CUDA');
    expect(html).toContain('queued_job, available_worker');
    expect(html).toContain('Severity-first queue');
  });
});
