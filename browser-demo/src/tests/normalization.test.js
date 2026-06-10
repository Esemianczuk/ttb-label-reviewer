import { describe, expect, it } from 'vitest';
import { parseAlcoholContent } from '../normalization/alcohol-normalize.js';
import { normalizeForFuzzyMatch, similarityScore } from '../normalization/text-normalize.js';
import { parseNetContents } from '../normalization/units-normalize.js';

describe('text normalization', () => {
  it('normalizes case, curly quotes, and punctuation for fuzzy matching', () => {
    expect(normalizeForFuzzyMatch('STONE’S THROW')).toBe('STONE S THROW');
    expect(similarityScore("Stone's Throw", 'STONE’S THROW')).toBeGreaterThan(0.9);
  });
});

describe('alcohol normalization', () => {
  it('parses ABV and proof formats', () => {
    expect(parseAlcoholContent('45% Alc./Vol. (90 Proof)')).toMatchObject({ abvPercent: 45, proof: 90 });
    expect(parseAlcoholContent('90 Proof')).toMatchObject({ abvPercent: 45, proof: 90 });
    expect(parseAlcoholContent('40% ALC BY VOL')).toMatchObject({ abvPercent: 40, proof: 80 });
  });
});

describe('unit normalization', () => {
  it('normalizes milliliters and liters', () => {
    expect(parseNetContents('750 mL')).toMatchObject({ amountMl: 750 });
    expect(parseNetContents('750ML')).toMatchObject({ amountMl: 750 });
    expect(parseNetContents('1.0 liter')).toMatchObject({ amountMl: 1000 });
  });

  it('normalizes common OCR substitutions for 750 mL', () => {
    expect(parseNetContents('75O ML')).toMatchObject({ amountMl: 750 });
    expect(parseNetContents('7/50ML')).toMatchObject({ amountMl: 750 });
    expect(parseNetContents('/50ML')).toMatchObject({ amountMl: 750 });
    expect(parseNetContents('T50 ML')).toMatchObject({ amountMl: 750 });
  });
});
