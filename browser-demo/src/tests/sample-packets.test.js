import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blocksFromText, createOcrResult } from '../ocr/ocr-types.js';
import { validateLabelPacket } from '../validation/overall.js';

const root = new URL('../..', import.meta.url).pathname;
const manifestPath = join(root, 'public/label-packets/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

function readJson(path) {
  return JSON.parse(readFileSync(join(root, 'public', path), 'utf8'));
}

function fixtureToResult(fixture) {
  return createOcrResult({
    engine: 'test-fixture',
    rawText: fixture.rawText,
    blocks: blocksFromText(fixture.rawText),
    processingTimeMs: 1,
    source: 'fixture',
  });
}

describe('sample packet library', () => {
  it('contains a one-image application queue with expected files and images', () => {
    expect(manifest.packets.length).toBeGreaterThanOrEqual(12);
    for (const packet of manifest.packets) {
      expect(packet.id).toBeTruthy();
      expect(packet.title).toBeTruthy();
      expect(existsSync(join(root, 'public', packet.expectedPath))).toBe(true);
      expect(existsSync(join(root, 'public', packet.ocrFixturePath))).toBe(true);
      expect(packet.images).toHaveLength(1);
      for (const image of packet.images) {
        expect(image.role).toBe('cola-sheet');
        expect(existsSync(join(root, 'public', image.path))).toBe(true);
      }
    }
  });

  it('validates packet fixtures to their declared outcomes', () => {
    for (const packet of manifest.packets) {
      const expected = readJson(packet.expectedPath);
      const fixture = readJson(packet.ocrFixturePath);
      const files = packet.images.map((image) => ({
        name: image.name,
        ocrResult: fixtureToResult(fixture.images[image.fixtureKey || image.id]),
      }));
      const review = validateLabelPacket(expected, files);
      expect(review.overallStatus, packet.id).toBe(packet.expectedOutcome);
    }
  });

  it('keeps the new classified COLA sheets passing', () => {
    for (const id of [
      'sunburst-social-peach-lime-fizz',
      'lumin8-blue-raspberry',
      'arbor-hill-cabernet-sauvignon',
      'northern-lights-vodka',
      'high-tide-pineapple-passionfruit',
      'estrella-tequila-blanco',
    ]) {
      const packet = manifest.packets.find((item) => item.id === id);
      const expected = readJson(packet.expectedPath);
      const fixture = readJson(packet.ocrFixturePath);
      const files = packet.images.map((image) => ({
        name: image.name,
        ocrResult: fixtureToResult(fixture.images[image.fixtureKey || image.id]),
      }));
      const review = validateLabelPacket(expected, files);
      expect(review.overallStatus, id).toBe('PASS');
      expect(review.fields.find((field) => field.field === 'Brand Name')?.status, id).toBe('PASS');
      expect(review.fields.find((field) => field.field === 'Government Warning')?.status, id).toBe('PASS');
    }
  });
});
