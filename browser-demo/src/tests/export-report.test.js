import { describe, expect, it } from 'vitest';
import { buildJsonReport } from '../ui/export.js';
import { STATUS } from '../validation/status.js';

describe('review report export', () => {
  it('preserves backend mode, engine, worker, timing, overrides, and notes', () => {
    const report = buildJsonReport({
      mode: 'backend',
      overallStatus: STATUS.PASS,
      application: { title: 'Backend Smoke' },
      expectedApplication: { brandName: 'HOLLOW RIDGE' },
      timings: { totalMs: 1200, queueMs: 100, ocrMs: 900, validationMs: 200 },
      enginesUsed: [{ id: 'null', displayName: 'Null OCR' }],
      workersUsed: [{ id: 'phase7-bigbertha' }],
      files: [
        {
          name: 'front.png',
          ocrResult: {
            processingTimeMs: 900,
            engine: 'null',
            source: 'local-backend',
            preprocessingNotes: ['Processed by local backend.'],
            rawText: 'HOLLOW RIDGE',
          },
        },
      ],
      fields: [
        {
          field: 'Brand Name',
          expected: 'HOLLOW RIDGE',
          extracted: 'HOLLOW RIDGE',
          status: STATUS.NEEDS_REVIEW,
          agentStatus: STATUS.PASS,
          reason: 'Worker evidence was close.',
          agentNote: 'Reviewer accepted capitalization.',
          confidence: 0.92,
          severity: 'critical',
          history: [{ actor: 'Agent', status: STATUS.PASS, note: 'Reviewer accepted capitalization.' }],
          evidenceCrops: [],
        },
      ],
    });

    expect(report.mode).toBe('backend');
    expect(report.timings.totalMs).toBe(1200);
    expect(report.enginesUsed[0].id).toBe('null');
    expect(report.workersUsed[0].id).toBe('phase7-bigbertha');
    expect(report.fields[0]).toMatchObject({
      autoStatus: STATUS.NEEDS_REVIEW,
      finalStatus: STATUS.PASS,
      agentNote: 'Reviewer accepted capitalization.',
    });
    expect(report.fields[0].history[0].actor).toBe('Agent');
  });
});
