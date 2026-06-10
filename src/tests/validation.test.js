import { describe, expect, it } from 'vitest';
import badAbv from './fixtures/ocr-bad-abv.json' with { type: 'json' };
import caseDifference from './fixtures/ocr-case-difference.json' with { type: 'json' };
import cleanOldTom from './fixtures/ocr-clean-old-tom.json' with { type: 'json' };
import missingWarning from './fixtures/ocr-missing-warning.json' with { type: 'json' };
import { validateAlcohol } from '../validation/alcohol.js';
import { validateBrand } from '../validation/brand.js';
import { validateClassType } from '../validation/class-type.js';
import { validateGovernmentWarning } from '../validation/government-warning.js';
import { validateNetContents } from '../validation/net-contents.js';
import { computeOverallStatus } from '../validation/overall.js';
import { STATUS } from '../validation/status.js';

describe('brand validator', () => {
  it('passes obvious case and quote variants', () => {
    expect(validateBrand("Stone's Throw", caseDifference).status).toBe(STATUS.PASS);
  });

  it('needs review when brand tokens are present but split by noisy OCR', () => {
    const noisy = {
      rawText: 'ESPECIAL\nJOSE CUERVO Disrillery\nPRODUCT OF MEXICO',
      blocks: [],
    };
    expect(validateBrand('Jose Cuervo Especial', noisy).status).toBe(STATUS.NEEDS_REVIEW);
  });

  it('flags different brands', () => {
    expect(validateBrand('BLUE RIVER DISTILLING', cleanOldTom).status).toBe(STATUS.FAIL);
  });
});

describe('alcohol validator', () => {
  it('passes matching ABV and proof values', () => {
    expect(validateAlcohol('45% Alc./Vol. (90 Proof)', cleanOldTom).status).toBe(STATUS.PASS);
    expect(validateAlcohol('45% Alc./Vol.', { rawText: '90 Proof', blocks: [] }).status).toBe(STATUS.PASS);
  });

  it('fails mismatched ABV values', () => {
    expect(validateAlcohol('45% Alc./Vol. (90 Proof)', badAbv).status).toBe(STATUS.FAIL);
  });
});

describe('class/type validator', () => {
  it('passes strong token coverage with OCR character substitutions', () => {
    const noisy = {
      rawText: 'BLUE AGAVER\nGOLD TEQUIPA',
      blocks: [],
    };
    expect(validateClassType('Blue Agave Gold Tequila', noisy).status).toBe(STATUS.PASS);
  });
});

describe('net contents validator', () => {
  it('passes equivalent milliliter and liter values', () => {
    expect(validateNetContents('750 mL', { rawText: '750 ml', blocks: [] }).status).toBe(STATUS.PASS);
    expect(validateNetContents('1 L', { rawText: '1000 mL', blocks: [] }).status).toBe(STATUS.PASS);
    expect(validateNetContents('750 mL', { rawText: '7/50ML 40% ALC BY VOL', blocks: [] }).status).toBe(STATUS.PASS);
  });

  it('needs review when OCR sees mL but not the amount', () => {
    const result = validateNetContents('750 mL', { rawText: 'ML 40% ALC BY VOL (80 PROOF)', blocks: [] });
    expect(result.status).toBe(STATUS.NEEDS_REVIEW);
  });

  it('fails clear net contents mismatches', () => {
    expect(validateNetContents('750 mL', { rawText: '375 mL', blocks: [] }).status).toBe(STATUS.FAIL);
  });
});

describe('government warning validator', () => {
  it('passes the full standard warning', () => {
    expect(validateGovernmentWarning(true, cleanOldTom).status).toBe(STATUS.PASS);
  });

  it('fails when the warning is missing', () => {
    expect(validateGovernmentWarning(true, missingWarning).status).toBe(STATUS.FAIL);
  });

  it('needs review when OCR contains a noisy warning with missing words', () => {
    const noisy = {
      rawText:
        'GOVERNMENT WARNING: According to Surgeon General women should not drink alcoholic beverages during pregnancy. Consumption of alcoholic beverages impairs ability to drive and may cause health problems.',
      blocks: [],
    };
    expect(validateGovernmentWarning(true, noisy).status).toBe(STATUS.NEEDS_REVIEW);
  });
});

describe('overall status', () => {
  it('prioritizes critical failures and review states', () => {
    expect(computeOverallStatus([{ status: STATUS.PASS, severity: 'info' }])).toBe(STATUS.PASS);
    expect(computeOverallStatus([{ status: STATUS.NEEDS_REVIEW, severity: 'warning' }])).toBe(STATUS.NEEDS_REVIEW);
    expect(computeOverallStatus([{ status: STATUS.FAIL, severity: 'critical' }])).toBe(STATUS.FAIL);
  });
});
