import { normalizeWhitespace } from './text-normalize.js';

const ML_PATTERN = /(\d{1,5}(?:\.\d+)?)\s*M\s*L\b/gi;
const LITER_PATTERN = /(\d{1,4}(?:\.\d+)?)\s*(?:L|LITER|LITRE|LITERS|LITRES)\b/gi;

export function parseNetContents(text = '') {
  const source = normalizeWhitespace(String(text).replace(/\u00a0/g, ' '));
  const mlMatches = [...source.matchAll(ML_PATTERN)];
  if (mlMatches.length) {
    const amount = Number.parseFloat(mlMatches[0][1]);
    if (Number.isFinite(amount)) {
      return { amountMl: amount, original: source };
    }
  }

  const literMatches = [...source.matchAll(LITER_PATTERN)];
  if (literMatches.length) {
    const amount = Number.parseFloat(literMatches[0][1]);
    if (Number.isFinite(amount)) {
      return { amountMl: amount * 1000, original: source };
    }
  }

  return null;
}

export function netContentsEquivalent(left, right, toleranceMl = 1) {
  if (!left || !right) return false;
  return Math.abs(left.amountMl - right.amountMl) <= toleranceMl;
}
