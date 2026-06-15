import { normalizeWhitespace } from './text-normalize.js';

const ABV_PATTERNS = [
  /ALC(?:OHOL)?\.?(?:\s+|[,;:]\s*)([0-9I1|lOBH%]{1,5})\s*(?:%\s*)?(?:(?:BY|B[YV]|RY)\s*)?V[O0C]?[L1I]?/gi,
  /(\d{1,3}(?:[\.,]\d+)?)\s*%\s*(?:ALC(?:OHOL)?\.?\s*(?:BY\s*)?(?:VOL(?:UME)?\.?|[/I1|]?\s*V[O0]L(?:UME)?\.?)|ABV)?/gi,
  /(\d{1,3}(?:[\.,]\d+)?)\s*(?:ALC(?:OHOL)?\.?\s*(?:BY\s*)?(?:VOL(?:UME)?\.?|[/I1|]?\s*V[O0]L(?:UME)?\.?)|ALC\s*[/I1|]?\s*V[O0]L|ALCIV[O0]L|ABV)/gi,
];

const PROOF_PATTERN = /(\d{1,3}(?:\.\d+)?)\s*PROOF/gi;

export function parseAlcoholContent(text = '') {
  const source = normalizeWhitespace(String(text).replace(/\u00a0/g, ' '));
  const abvValues = [];
  const proofValues = [];

  for (const pattern of ABV_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const value = normalizeOcrAbvNumber(match[1]);
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

function normalizeOcrAbvNumber(value = '') {
  const source = normalizeWhitespace(String(value).toUpperCase());
  const cleaned = source
    .replace(/[I|L]/g, '1')
    .replace(/[OQ]/g, '0')
    .replace(/B/g, '3')
    .replace(/S/g, '5')
    .replace(/%/g, '')
    .replace(/[^0-9\.,]/g, '');
  if (!cleaned) return null;
  let numeric = Number.parseFloat(cleaned.replace(',', '.'));
  if (!Number.isFinite(numeric)) return null;
  if (numeric > 100 && !cleaned.includes('.') && !cleaned.includes(',')) {
    const suffix = cleaned.slice(-2);
    if (cleaned.length === 4 && ['60', '66', '68', '69', '80', '86', '88', '89'].includes(suffix)) {
      numeric = Number.parseFloat(cleaned.slice(0, 2));
    } else if (numeric <= 999) {
      const lastDigit = cleaned.at(-1);
      if (['0', '6', '8', '9'].includes(lastDigit)) {
        numeric = Number.parseFloat(cleaned.slice(0, -1));
      } else if (cleaned.length === 3) {
        numeric /= 10;
      }
    }
  }
  return numeric;
}

export function alcoholValuesEquivalent(left, right, tolerance = 0.25) {
  if (!left || !right || left.abvPercent === null || right.abvPercent === null) return false;
  return Math.abs(left.abvPercent - right.abvPercent) <= tolerance;
}
