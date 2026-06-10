import { normalizeWhitespace } from './text-normalize.js';

const ABV_PATTERNS = [
  /(\d{1,3}(?:\.\d+)?)\s*%\s*(?:ALC(?:OHOL)?\.?\s*(?:BY\s*)?VOL(?:UME)?\.?|ABV)?/gi,
  /(\d{1,3}(?:\.\d+)?)\s*(?:ALC(?:OHOL)?\.?\s*(?:BY\s*)?VOL(?:UME)?\.?|ABV)/gi,
];

const PROOF_PATTERN = /(\d{1,3}(?:\.\d+)?)\s*PROOF/gi;

export function parseAlcoholContent(text = '') {
  const source = normalizeWhitespace(String(text).replace(/\u00a0/g, ' '));
  const abvValues = [];
  const proofValues = [];

  for (const pattern of ABV_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const value = Number.parseFloat(match[1]);
      if (Number.isFinite(value) && value > 0 && value <= 100) {
        abvValues.push(value);
      }
    }
  }

  for (const match of source.matchAll(PROOF_PATTERN)) {
    const value = Number.parseFloat(match[1]);
    if (Number.isFinite(value) && value > 0 && value <= 200) {
      proofValues.push(value);
    }
  }

  const proof = proofValues[0] ?? null;
  const abvPercent = abvValues[0] ?? (proof !== null ? proof / 2 : null);

  if (abvPercent === null && proof === null) return null;

  return {
    abvPercent,
    proof: proof ?? (abvPercent !== null ? abvPercent * 2 : null),
    original: source,
  };
}

export function alcoholValuesEquivalent(left, right, tolerance = 0.25) {
  if (!left || !right || left.abvPercent === null || right.abvPercent === null) return false;
  return Math.abs(left.abvPercent - right.abvPercent) <= tolerance;
}
