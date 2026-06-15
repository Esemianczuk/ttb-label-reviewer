import { describe, expect, it } from 'vitest';
import { createOcrResult } from '../ocr/ocr-types.js';
import { similarityScore } from '../normalization/text-normalize.js';
import { validateClassType } from '../validation/class-type.js';
import { validateLabelPacket } from '../validation/overall.js';

const GOVERNMENT_WARNING =
  'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.';

describe('Skeptic public COLA validation calibration', () => {
  it('matches stylized SKE?TIC brand text to SKEPTIC OCR evidence', () => {
    expect(similarityScore('SKE?TIC', 'SKEPTIC')).toBeGreaterThanOrEqual(0.84);
  });

  it('passes the SKE?TIC GIN SPECIALTIES packet when the label supplies SKEPTIC, GIN, and SPIRITS evidence', () => {
    const expected = {
      brandName: 'SKE?TIC',
      fancifulName: 'GINQUILA REPOSADO',
      classType: 'GIN SPECIALTIES',
      alcoholContent: '40% ALC/VOL (80 PROOF)',
      netContents: '750 mL',
      governmentWarningRequired: true,
      producerName: 'Skeptic Distillery CO.',
    };
    const ocrResult = createOcrResult({
      engine: 'skeptic-regression-fixture',
      rawText: [
        'SKEPTIC',
        'GINQUILA REPOSADO',
        'GIN',
        'DISTILLED SPIRITS',
        '40% ALC/VOL (80 PROOF)',
        '750 ML',
        'Skeptic Distillery CO.',
        GOVERNMENT_WARNING,
      ].join('\n'),
    });

    const review = validateLabelPacket(expected, [{ id: 'skeptic-front', name: 'skeptic-front.jpg', url: '', ocrResult }]);
    const brand = review.fields.find((field) => field.field === 'Brand Name');
    const classType = review.fields.find((field) => field.field === 'Class/Type');

    expect(brand).toMatchObject({
      status: 'PASS',
      extracted: 'SKEPTIC',
    });
    expect(classType).toMatchObject({
      status: 'PASS',
      extracted: 'GIN:GIN, SPECIALTIES:SPIRITS',
    });
    expect(classType.evidence).toMatchObject({
      method: 'specialty-class-spirit-synonym',
      evidence: 'GIN:GIN, SPECIALTIES:SPIRITS',
    });
  });

  it('does not pass a specialty class from the base spirit term alone', () => {
    const review = validateClassType('GIN SPECIALTIES', createOcrResult({ rawText: 'GIN TONIC READY TO DRINK' }));
    expect(review.status).not.toBe('PASS');
  });
});
