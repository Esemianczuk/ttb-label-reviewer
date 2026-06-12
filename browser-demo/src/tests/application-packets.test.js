import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createApplicationPacketFromSample,
  normalizeImageRole,
  normalizeProductType,
} from '../ui/application-packets.js';

const browserRoot = new URL('../..', import.meta.url).pathname;
const repoRoot = join(browserRoot, '..');
const manifest = JSON.parse(readFileSync(join(browserRoot, 'public/label-packets/manifest.json'), 'utf8'));
const applicationSchema = JSON.parse(readFileSync(join(repoRoot, 'packages/shared/schemas/application.schema.json'), 'utf8'));
const reviewSchema = JSON.parse(readFileSync(join(repoRoot, 'packages/shared/schemas/review.schema.json'), 'utf8'));
const jobSchema = JSON.parse(readFileSync(join(repoRoot, 'packages/shared/schemas/job.schema.json'), 'utf8'));

function readExpected(path) {
  return JSON.parse(readFileSync(join(browserRoot, 'public', path), 'utf8'));
}

function imageEntriesForPacket(packet) {
  return packet.images.map((image) => ({
    id: `${packet.id}:${image.id}`,
    packetId: packet.id,
    role: image.role || image.id,
    name: image.name,
    type: image.type || 'image/png',
    size: image.size || 0,
    url: image.path,
    source: 'sample',
  }));
}

function expectOnlySchemaKeys(object, schemaProperties) {
  for (const key of Object.keys(object)) {
    expect(schemaProperties[key], key).toBeTruthy();
  }
}

function expectSchemaValid(value, schema) {
  expect(validateAgainstSchema(value, schema), JSON.stringify(value, null, 2)).toEqual([]);
}

function validateAgainstSchema(value, schema, root = schema, path = '$') {
  if (schema.$ref) {
    return validateAgainstSchema(value, resolveRef(root, schema.$ref), root, path);
  }
  const errors = [];
  const allowedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (allowedTypes.length && !allowedTypes.some((type) => valueMatchesType(value, type))) {
    return [`${path} expected ${allowedTypes.join('|')}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} expected enum ${schema.enum.join('|')}`);
  if (typeof value === 'string') {
    if (schema.minLength && value.length < schema.minLength) errors.push(`${path} is shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path} does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} is below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} is above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} has too few items`);
    value.forEach((item, index) => errors.push(...validateAgainstSchema(item, schema.items || {}, root, `${path}[${index}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${path}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!properties[key]) errors.push(`${path}.${key} is not allowed`);
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (value[key] !== undefined) errors.push(...validateAgainstSchema(value[key], propertySchema, root, `${path}.${key}`));
    }
  }
  return errors;
}

function resolveRef(root, ref) {
  return ref
    .replace(/^#\//, '')
    .split('/')
    .reduce((schema, part) => schema[part], root);
}

function valueMatchesType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
}

describe('shared packet schemas', () => {
  it('defines the canonical contracts needed by browser, backend, and workers', () => {
    expect(applicationSchema.title).toBe('ApplicationPacket');
    expect(applicationSchema.required).toEqual(['id', 'applicationId', 'source', 'status', 'expectedFields', 'images', 'metadata']);
    expect(applicationSchema.properties.source.enum).toContain('sample');
    expect(applicationSchema.$defs.ApplicationStatus.enum).toContain('SUBMITTED');
    expect(applicationSchema.$defs.ApplicationImage.properties.role.enum).toContain('cola_sheet');
    expect(reviewSchema.title).toBe('ReviewResult');
    expect(reviewSchema.$defs.ReviewStatus.enum).toContain('NOT_APPLICABLE');
    expect(reviewSchema.$defs.FieldReview.properties.reviewerStatus).toBeTruthy();
    expect(reviewSchema.$defs.EvidenceCandidate.required).toEqual(['text', 'method']);
    expect(jobSchema.title).toBe('ReviewJob');
    expect(jobSchema.required).toContain('updatedAt');
    expect(jobSchema.properties.jobType.enum).toContain('ocr');
  });

  it('validates canonical application, review, and job payloads', () => {
    const packet = manifest.packets[0];
    const expected = readExpected(packet.expectedPath);
    const applicationPacket = createApplicationPacketFromSample(packet, expected, imageEntriesForPacket(packet), {
      createdAt: '2026-06-10T00:00:00.000Z',
    });
    const reviewResult = {
      id: 'review-schema-smoke',
      packetId: applicationPacket.id,
      applicationId: applicationPacket.applicationId,
      mode: 'browser',
      overallStatus: 'PASS',
      fields: [
        {
          fieldKey: 'brandName',
          field: 'Brand Name',
          expected: expected.brandName,
          extracted: expected.brandName,
          status: 'PASS',
          severity: 'critical',
          confidence: 0.99,
          reason: 'Exact sample evidence match.',
          evidence: [{ text: expected.brandName, method: 'fixture' }],
        },
      ],
      files: [{ imageId: applicationPacket.images[0].id, filename: applicationPacket.images[0].name, engine: 'fixture', timingMs: 0 }],
      timings: { totalMs: 1, ocrMs: 0, validationMs: 1 },
      enginesUsed: [{ engineId: 'fixture', timingMs: 0 }],
      workersUsed: [{ workerId: 'browser-main-thread', mode: 'browser' }],
      createdAt: '2026-06-10T00:00:00.000Z',
    };
    const reviewJob = {
      id: 'job-schema-smoke',
      applicationId: applicationPacket.id,
      sessionId: 'browser-session',
      jobType: 'ocr',
      status: 'queued',
      priority: 100,
      payload: { imageId: applicationPacket.images[0].id },
      createdAt: '2026-06-10T00:00:00.000Z',
      updatedAt: '2026-06-10T00:00:00.000Z',
    };

    expectSchemaValid(applicationPacket, applicationSchema);
    expectSchemaValid(reviewResult, reviewSchema);
    expectSchemaValid(reviewJob, jobSchema);
    expect(validateAgainstSchema({ ...applicationPacket, status: 'made_up' }, applicationSchema)).toContain('$.status expected enum DRAFT|PRECHECK_RUNNING|APPLICANT_FIX_REQUIRED|READY_TO_SUBMIT|SUBMITTED|IN_REVIEW|NEEDS_CORRECTION|RESUBMITTED|CONDITIONALLY_APPROVED|APPROVED|REJECTED|WITHDRAWN|ARCHIVED');
  });
});

describe('ApplicationPacket sample adapter', () => {
  it('normalizes product and image role values', () => {
    expect(normalizeProductType('Distilled Spirits')).toBe('distilled_spirits');
    expect(normalizeProductType('not-a-type')).toBe('unknown');
    expect(normalizeImageRole('cola-sheet')).toBe('cola_sheet');
    expect(normalizeImageRole('front')).toBe('front');
    expect(normalizeImageRole('mystery')).toBe('unknown');
  });

  it('adapts every browser sample to the canonical ApplicationPacket shape', () => {
    const sourceEnum = applicationSchema.properties.source.enum;
    const productTypeEnum = applicationSchema.$defs.ExpectedFields.properties.productType.enum;
    const imageRoleEnum = applicationSchema.$defs.ApplicationImage.properties.role.enum;
    const seenIds = new Set();

    for (const packet of manifest.packets) {
      const expected = readExpected(packet.expectedPath);
      const applicationPacket = createApplicationPacketFromSample(packet, expected, imageEntriesForPacket(packet), {
        createdAt: '2026-06-10T00:00:00.000Z',
      });

      expectSchemaValid(applicationPacket, applicationSchema);
      expectOnlySchemaKeys(applicationPacket, applicationSchema.properties);
      expect(seenIds.has(applicationPacket.id)).toBe(false);
      seenIds.add(applicationPacket.id);
      expect(sourceEnum).toContain(applicationPacket.source);
      expect(applicationPacket.source).toBe('sample');
      expect(applicationPacket.status).toBe('SUBMITTED');
      expect(applicationPacket.expectedFields.brandName).toBe(expected.brandName);
      expect(applicationPacket.expectedFields.classType).toBe(expected.classType);
      expect(applicationPacket.expectedFields.alcoholContent).toBe(expected.alcoholContent);
      expect(applicationPacket.expectedFields.netContents).toBe(expected.netContents);
      expect(typeof applicationPacket.expectedFields.governmentWarningRequired).toBe('boolean');
      expect(productTypeEnum).toContain(applicationPacket.expectedFields.productType);
      expect(applicationPacket.images).toHaveLength(packet.images.length);
      expect(applicationPacket.metadata.createdAt).toBe('2026-06-10T00:00:00.000Z');

      for (const image of applicationPacket.images) {
        expectOnlySchemaKeys(image, applicationSchema.$defs.ApplicationImage.properties);
        expect(imageRoleEnum).toContain(image.role);
        expect(image.mimeType).toMatch(/^image\/(png|jpe?g|webp)$/);
        expect(image.name).toBeTruthy();
      }
    }
  });
});
