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
