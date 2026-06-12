import { describe, expect, it } from 'vitest';
import caseDifference from './fixtures/ocr-case-difference.json' with { type: 'json' };
import cleanBourbon from './fixtures/ocr-clean-bourbon.json' with { type: 'json' };
import { findBestTextCandidate, findRegexCandidates } from '../extraction/candidate-search.js';

describe('candidate search', () => {
  it('finds fuzzy expected text candidates', () => {
    const candidate = findBestTextCandidate("Stone's Throw", caseDifference);
    expect(candidate.score).toBeGreaterThan(0.9);
  });

  it('prefers located OCR evidence over raw text-only ties', () => {
    const candidate = findBestTextCandidate('DEVILS BACKBONE', {
      rawText: 'QEVILS BACKBOY',
      blocks: [
        {
          text: 'QEVILS BACKBoy,',
          confidence: 0.54,
          bbox: { x: 504, y: 632, width: 257, height: 45 },
          imageId: 'devils-image',
        },
      ],
    });

    expect(candidate.method).toBe('fuzzy-expected-match');
    expect(candidate.block.bbox).toEqual({ x: 504, y: 632, width: 257, height: 45 });
  });

  it('finds regex candidates in raw OCR text', () => {
    const candidates = findRegexCandidates(/\d{1,3}\s*%\s*ALC/gi, cleanBourbon);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].evidence).toContain('45%');
  });
});
