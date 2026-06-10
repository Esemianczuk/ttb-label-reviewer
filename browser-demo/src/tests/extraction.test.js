import { describe, expect, it } from 'vitest';
import caseDifference from './fixtures/ocr-case-difference.json' with { type: 'json' };
import cleanOldTom from './fixtures/ocr-clean-old-tom.json' with { type: 'json' };
import { findBestTextCandidate, findRegexCandidates } from '../extraction/candidate-search.js';

describe('candidate search', () => {
  it('finds fuzzy expected text candidates', () => {
    const candidate = findBestTextCandidate("Stone's Throw", caseDifference);
    expect(candidate.score).toBeGreaterThan(0.9);
  });

  it('finds regex candidates in raw OCR text', () => {
    const candidates = findRegexCandidates(/\d{1,3}\s*%\s*ALC/gi, cleanOldTom);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].evidence).toContain('45%');
  });
});
