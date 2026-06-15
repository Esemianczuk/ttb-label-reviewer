import { normalizeWhitespace } from './text-normalize.js';

const ML_PATTERN = /(\d{1,5}(?:\.\d+)?)\s*M\s*L\b/gi;
const LITER_PATTERN = /(\d{1,4}(?:\.\d+)?)\s*(?:L|LITER|LITRE|LITERS|LITRES)\b/gi;
const PINT_FL_OZ_PATTERN = /([0-9I|l]{1,3}(?:\.\d+)?)\s*P(?:IN)?T(?:\s+(\d{1,3}(?:\.\d+)?)\s*FL\.?\s*[O0]Z\.?)?/gi;
const FL_OZ_PATTERN = /(\d{1,3}(?:\.\d+)?)\s*FL\.?\s*[O0]Z\.?/gi;
const COMMON_OCR_750_ML_PATTERN = /(?:750|75O|7S0|7SO|T50|TS0|7\/50|\/50)M?L/i;

export function parseNetContents(text = '') {
  const source = normalizeWhitespace(String(text).replace(/\u00a0/g, ' '));
  const compactSource = source.toLocaleUpperCase('en-US').replace(/\s+/g, '');

  if (COMMON_OCR_750_ML_PATTERN.test(compactSource)) {
    return { amountMl: 750, original: source };
  }

  const mlMatches = [...source.matchAll(ML_PATTERN)];
  if (mlMatches.length) {
    const amount = Number.parseFloat(mlMatches[0][1]);
    if (Number.isFinite(amount)) {
      return { amountMl: amount, original: source };
    }
  }

  const pintMatches = [...source.matchAll(PINT_FL_OZ_PATTERN)];
  if (pintMatches.length) {
    const pints = ocrNumberToFloat(pintMatches[0][1]);
    const fluidOunces = Number.parseFloat(pintMatches[0][2] || '0');
    if (Number.isFinite(pints) && Number.isFinite(fluidOunces)) {
      return { amountMl: (pints * 16 + fluidOunces) * 29.5735295625, original: source };
    }
  }

  const flOzMatches = [...source.matchAll(FL_OZ_PATTERN)];
  if (flOzMatches.length) {
    const amount = Number.parseFloat(flOzMatches[0][1]);
    if (Number.isFinite(amount)) {
      return { amountMl: amount * 29.5735295625, original: source };
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

function ocrNumberToFloat(value = '') {
  return Number.parseFloat(
    String(value)
      .toLocaleUpperCase('en-US')
      .replace(/I/g, '1')
      .replace(/L/g, '1')
      .replace(/\|/g, '1')
      .replace(/O/g, '0')
      .replace(/,/g, '.'),
  );
}
