import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createOcrResult } from '../ocr/ocr-types.js';
import { validateLabelPacket } from '../validation/overall.js';

const goldenDir = path.resolve(process.cwd(), '../packages/shared/validation-golden');
const fieldKeyByLabel = {
  'Brand Name': 'brandName',
  'Fanciful Name': 'fancifulName',
  'Class/Type': 'classType',
  'Alcohol Content': 'alcoholContent',
  'Net Contents': 'netContents',
  'Government Warning': 'governmentWarningRequired',
  'Producer / Bottler / Importer': 'producerName',
  'Country of Origin': 'countryOfOrigin',
};

function loadFixtures() {
  return fs
    .readdirSync(goldenDir)
    .filter((filename) => filename.endsWith('.json'))
    .sort()
    .map((filename) => JSON.parse(fs.readFileSync(path.join(goldenDir, filename), 'utf8')));
}

describe('shared validation golden fixtures', () => {
  for (const fixture of loadFixtures()) {
    it(`${fixture.id}: browser validator matches expected statuses`, () => {
      const ocrResult = createOcrResult({ rawText: fixture.ocrText, engine: 'golden-fixture' });
      const review = validateLabelPacket(fixture.expectedFields, [
        {
          id: `${fixture.id}-image`,
          name: `${fixture.id}.png`,
          url: '',
          ocrResult,
        },
      ]);
      const statuses = Object.fromEntries(review.fields.map((field) => [fieldKeyByLabel[field.field], field.status]));

      expect(review.overallStatus).toBe(fixture.expectedOverallStatus);
      for (const [fieldKey, status] of Object.entries(fixture.expectedStatuses)) {
        expect(statuses[fieldKey]).toBe(status);
      }
    });
  }
});
