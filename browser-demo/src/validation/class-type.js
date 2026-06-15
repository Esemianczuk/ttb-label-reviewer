import { findBestTextCandidate, scoreExpectedTokenCoverage } from '../extraction/candidate-search.js';
import { similarityScore, tokenizeForMatch } from '../normalization/text-normalize.js';
import { makeReview, SEVERITY, STATUS } from './status.js';

const SPECIALTY_CLASS_TERMS = new Set(['SPECIALTIES', 'SPECIALTY', 'SPECIALITIES', 'SPECIALITY', 'SPECIAL']);
const SPIRITS_EVIDENCE_TERMS = new Set(['SPIRITS', 'SPIRIT']);
const GENERIC_CLASS_MODIFIERS = new Set(['OTHER', 'FOREIGN', 'TABLE', 'COCKTAILS', 'COCKTAIL', '48', 'PROOF', 'UP']);
const SPECIALTY_EVIDENCE_TERMS = new Set([
  ...SPECIALTY_CLASS_TERMS,
  ...SPIRITS_EVIDENCE_TERMS,
  'COCKTAIL',
  'COCKTAILS',
  'FLAVOR',
  'FLAVORS',
  'FLAVORED',
  'FLAVOURED',
  'NATURAL',
  'SODA',
  'WATER',
  'LIME',
  'MIXED',
  'CARBONATED',
  'CARBONATION',
  'GINGER',
  'COCONUT',
  'BARREL',
  'AGED',
]);
const COCKTAIL_PAIRINGS = [
  new Set(['GIN', 'TONIC']),
  new Set(['VODKA', 'MULE']),
  new Set(['RUM', 'COLA']),
  new Set(['WHISKEY', 'COLA']),
  new Set(['WHISKY', 'COLA']),
];
const BASE_SPIRIT_TERMS = [
  { expected: ['GIN'], evidence: ['GIN'] },
  { expected: ['VODKA'], evidence: ['VODKA'] },
  { expected: ['RUM'], evidence: ['RUM'] },
  { expected: ['TEQUILA'], evidence: ['TEQUILA'] },
  { expected: ['BRANDY'], evidence: ['BRANDY'] },
  { expected: ['WHISKY', 'WHISKEY'], evidence: ['WHISKY', 'WHISKEY'] },
  { expected: ['BOURBON'], evidence: ['BOURBON'] },
];
const WHITE_WINE_VARIETALS = [
  { evidence: ['SAUVIGNON', 'BLANC'], label: 'SAUVIGNON BLANC', score: 0.92 },
  { evidence: ['CHARDONNAY'], label: 'CHARDONNAY', score: 0.9 },
  { evidence: ['RIESLING'], label: 'RIESLING', score: 0.9 },
  { evidence: ['PINOT', 'GRIGIO'], label: 'PINOT GRIGIO', score: 0.9 },
  { evidence: ['PINOT', 'GRIS'], label: 'PINOT GRIS', score: 0.9 },
  { evidence: ['MOSCATO'], label: 'MOSCATO', score: 0.88 },
  { evidence: ['WHITE', 'WINE'], label: 'WHITE WINE', score: 0.94 },
];
const RED_WINE_VARIETALS = [
  { evidence: ['CABERNET'], label: 'CABERNET', score: 0.9 },
  { evidence: ['MERLOT'], label: 'MERLOT', score: 0.9 },
  { evidence: ['PINOT', 'NOIR'], label: 'PINOT NOIR', score: 0.9 },
  { evidence: ['SYRAH'], label: 'SYRAH', score: 0.88 },
  { evidence: ['SHIRAZ'], label: 'SHIRAZ', score: 0.88 },
  { evidence: ['MALBEC'], label: 'MALBEC', score: 0.88 },
  { evidence: ['RED', 'WINE'], label: 'RED WINE', score: 0.94 },
];

export function validateClassType(expected, ocrResult) {
  const field = 'Class/Type';
  if (!expected) {
    return makeReview({
      field,
      expected,
      status: STATUS.WARNING,
      severity: SEVERITY.WARNING,
      reason: 'No expected class/type was entered.',
    });
  }

  const candidate = findBestTextCandidate(expected, ocrResult, { slack: 4 });
  const tokenCoverage = scoreExpectedTokenCoverage(expected, ocrResult);
  const semanticClassEvidence = findSemanticClassEvidence(expected, ocrResult, tokenCoverage);
  const bestEvidence = tokenCoverage && (!candidate || tokenCoverage.score > candidate.score) ? tokenCoverage : candidate;

  if (!semanticClassEvidence && (!bestEvidence || (bestEvidence.score < 0.42 && (!tokenCoverage || tokenCoverage.coverage < 0.5)))) {
    return makeReview({
      field,
      expected,
      status: STATUS.NOT_FOUND,
      severity: SEVERITY.CRITICAL,
      reason: 'Expected class/type was not found in the label text.',
    });
  }

  if (candidate?.score >= 0.9 || (tokenCoverage?.coverage === 1 && tokenCoverage.score >= 0.92) || semanticClassEvidence) {
    const evidence = candidate?.score >= 0.9 ? candidate : semanticClassEvidence || tokenCoverage;
    return makeReview({
      field,
      expected,
      extracted: evidence.value || evidence.evidence,
      status: STATUS.PASS,
      confidence: evidence.score,
      reason:
        evidence.method?.startsWith('semantic-class') || evidence.method === 'specialty-class-spirit-synonym'
          ? 'Expected class/type is corroborated by base beverage terms and registry wording on the label.'
          : 'Expected class/type appears on the label.',
      evidence,
    });
  }

  if (candidate?.score >= 0.68 || tokenCoverage?.coverage >= 0.75) {
    const evidence = candidate?.score >= 0.68 ? candidate : tokenCoverage;
    return makeReview({
      field,
      expected,
      extracted: evidence.value || evidence.evidence,
      status: STATUS.NEEDS_REVIEW,
      severity: SEVERITY.WARNING,
      confidence: evidence.score,
      reason:
        evidence.method === 'expected-token-coverage'
          ? 'Expected class/type tokens were found across the OCR output, but should be reviewed for OCR substitutions.'
          : 'A related class/type phrase was found, but it is not a confident exact match.',
      evidence,
    });
  }

  return makeReview({
    field,
    expected,
    extracted: bestEvidence.evidence,
    status: STATUS.FAIL,
    severity: SEVERITY.CRITICAL,
    confidence: bestEvidence.score,
    reason: 'The closest detected class/type text does not match the expected value.',
    evidence: bestEvidence,
  });
}

function findSemanticClassEvidence(expected, ocrResult = {}, tokenCoverage = null) {
  const expectedTokens = tokenizeForMatch(expected);
  const ocrTokens = significantTokens(ocrResult.rawText || '');
  if (!expectedTokens.length || !ocrTokens.length) return null;
  return (
    findCocktailClassEvidence(expectedTokens, ocrTokens, tokenCoverage) ||
    findHoneyWineClassEvidence(expectedTokens, ocrTokens, tokenCoverage) ||
    findTableWineClassEvidence(expectedTokens, ocrTokens, tokenCoverage) ||
    findSpecialtyClassEvidence(expectedTokens, ocrTokens, tokenCoverage) ||
    findCoreClassEvidence(expectedTokens, ocrTokens)
  );
}

function findCoreClassEvidence(expectedTokens, ocrTokens) {
  const meaningfulTokens = expectedTokens.filter((token) => !GENERIC_CLASS_MODIFIERS.has(token));
  if (!meaningfulTokens.length) return null;
  const matches = meaningfulTokens.map((token) => bestTokenMatch(token, ocrTokens)).filter(Boolean);
  const matched = matches.filter((match) => match.score >= minimumTokenScore(match.expected));
  if (matched.length / meaningfulTokens.length < 1) return null;
  const score = matched.reduce((sum, match) => sum + match.score, 0) / matched.length;
  const evidenceText = matched.map((match) => `${match.expected}:${match.detected}`).join(', ');
  return {
    value: evidenceText,
    evidence: evidenceText,
    score: Math.min(1, score),
    coverage: 1,
    confidence: null,
    block: null,
    method: 'semantic-class-core-token-match',
    matches: matched,
  };
}

function findCocktailClassEvidence(expectedTokens, ocrTokens, tokenCoverage) {
  if (!expectedTokens.includes('COCKTAILS') && !expectedTokens.includes('COCKTAIL')) return null;
  const tokenSet = new Set(ocrTokens);
  for (const pairing of COCKTAIL_PAIRINGS) {
    if ([...pairing].every((token) => tokenSet.has(token))) {
      const evidenceText = [...pairing].sort().map((token) => `${token}:${token}`).join(', ');
      return {
        value: evidenceText,
        evidence: evidenceText,
        score: Math.max(tokenCoverage?.score || 0, 0.92),
        coverage: 1,
        confidence: null,
        block: null,
        method: 'semantic-class-cocktail-pairing',
        matches: [...pairing].sort().map((token) => ({ expected: token, detected: token, score: 1 })),
      };
    }
  }
  if (tokenSet.has('READY') && tokenSet.has('DRINK')) {
    return {
      value: 'COCKTAILS:READY TO DRINK',
      evidence: 'COCKTAILS:READY TO DRINK',
      score: 0.86,
      coverage: 1,
      confidence: null,
      block: null,
      method: 'semantic-class-cocktail-ready-to-drink',
      matches: [{ expected: 'COCKTAILS', detected: 'READY TO DRINK', score: 0.86 }],
    };
  }
  return null;
}

function findHoneyWineClassEvidence(expectedTokens, ocrTokens, tokenCoverage) {
  if (!expectedTokens.includes('HONEY') || !expectedTokens.includes('WINE')) return null;
  const tokenSet = new Set(ocrTokens);
  const meadTerm = ocrTokens.find((token) => token === 'MEAD' || token === 'MEADERY' || similarityScore('MEAD', token) >= 0.82);
  if (!tokenSet.has('HONEY') || !meadTerm) return null;
  const evidenceText = `HONEY:HONEY, WINE:${meadTerm}`;
  return {
    value: evidenceText,
    evidence: evidenceText,
    score: Math.max(tokenCoverage?.score || 0, 0.92),
    coverage: 1,
    confidence: null,
    block: null,
    method: 'semantic-class-honey-mead-wine',
    matches: [
      { expected: 'HONEY', detected: 'HONEY', score: 1 },
      { expected: 'WINE', detected: meadTerm, score: 0.9 },
    ],
  };
}

function findTableWineClassEvidence(expectedTokens, ocrTokens, tokenCoverage) {
  if (!expectedTokens.includes('WINE')) return null;
  const tokenSet = new Set(ocrTokens);
  const expectedColor = expectedTokens.includes('WHITE') ? 'WHITE' : expectedTokens.includes('RED') ? 'RED' : null;
  const varietals = expectedColor === 'WHITE' ? WHITE_WINE_VARIETALS : expectedColor === 'RED' ? RED_WINE_VARIETALS : null;
  if (!expectedColor || !varietals) return null;

  let best = null;
  for (const varietal of varietals) {
    if (!varietal.evidence.every((token) => tokenSet.has(token))) continue;
    if (!best || varietal.score > best.score) best = varietal;
  }
  if (!best) return null;

  const evidenceText = `${expectedColor}:${best.label}, WINE:${best.label}`;
  const score = Math.max(tokenCoverage?.score || 0, best.score);
  return {
    value: evidenceText,
    evidence: evidenceText,
    score: Math.min(1, score),
    coverage: 1,
    confidence: null,
    block: null,
    method: 'semantic-class-table-wine-varietal',
    matches: [
      { expected: expectedColor, detected: best.label, score: best.score },
      { expected: 'WINE', detected: best.label, score: best.score },
    ],
  };
}

function findSpecialtyClassEvidence(expected, ocrResult = {}, tokenCoverage = null) {
  const expectedTokens = Array.isArray(expected) ? expected : tokenizeForMatch(expected);
  if (!expectedTokens.some((token) => SPECIALTY_CLASS_TERMS.has(token))) return null;

  const ocrTokens = Array.isArray(ocrResult) ? ocrResult : significantTokens(ocrResult.rawText || '');
  if (!ocrTokens.length) return null;

  let baseMatch = findBaseSpiritMatch(expectedTokens, ocrTokens);
  if (!baseMatch && hasGenericSpecialtyClass(expectedTokens)) {
    baseMatch = findAnyBaseSpiritMatch(ocrTokens);
  }
  const maltMatch = findMaltBeverageMatch(expectedTokens, ocrTokens);
  if (!baseMatch && !maltMatch) return null;

  const specialtyMatch = findSpecialtyEvidenceToken(ocrTokens);
  if (!specialtyMatch) return null;

  const base = baseMatch || maltMatch;
  const semanticScore = SPIRITS_EVIDENCE_TERMS.has(specialtyMatch.detected) ? 0.66 : Math.max(base.score, specialtyMatch.score);
  const score = Math.max(tokenCoverage?.score || 0, semanticScore);
  const evidenceText = `${base.expected}:${base.detected}, SPECIALTIES:${specialtyMatch.detected}`;
  return {
    value: evidenceText,
    evidence: evidenceText,
    score,
    coverage: Math.max(tokenCoverage?.coverage || 0, 1),
    confidence: null,
    block: null,
    method: 'specialty-class-spirit-synonym',
    matches: [
      base,
      { expected: 'SPECIALTIES', detected: specialtyMatch.detected, score: specialtyMatch.score },
    ],
  };
}

function hasGenericSpecialtyClass(expectedTokens) {
  return ['OTHER', 'PROPRIETARY', 'PROPRIETARIES', 'PROPRIETORS'].some((token) => expectedTokens.includes(token));
}

function findAnyBaseSpiritMatch(ocrTokens) {
  let best = null;
  for (const term of BASE_SPIRIT_TERMS) {
    const expected = [...term.expected].sort()[0];
    for (const detected of ocrTokens) {
      const score = Math.max(...term.evidence.map((evidenceTerm) => similarityScore(evidenceTerm, detected)));
      if (score >= 0.86 && (!best || score > best.score)) best = { expected, detected, score };
    }
  }
  return best;
}

function findBaseSpiritMatch(expectedTokens, ocrTokens) {
  for (const term of BASE_SPIRIT_TERMS) {
    const expected = term.expected.find((token) => expectedTokens.includes(token));
    if (!expected) continue;
    let best = null;
    for (const detected of ocrTokens) {
      const score = Math.max(...term.evidence.map((evidenceTerm) => similarityScore(evidenceTerm, detected)));
      if (score >= 0.86 && (!best || score > best.score)) best = { expected, detected, score };
    }
    if (best) return best;
  }
  return null;
}

function findMaltBeverageMatch(expectedTokens, ocrTokens) {
  if (!expectedTokens.includes('MALT') && !expectedTokens.includes('BEER')) return null;
  const candidates = ['MALT', 'BEER', 'BEVERAGE', 'BEVERAGES', 'ALE', 'LAGER', 'PORTER', 'STOUT'];
  let best = null;
  for (const expected of ['MALT', 'BEER']) {
    if (!expectedTokens.includes(expected)) continue;
    for (const detected of ocrTokens) {
      const score = Math.max(...candidates.map((candidate) => similarityScore(candidate, detected)));
      if (score >= 0.78 && (!best || score > best.score)) best = { expected, detected, score };
    }
  }
  return best;
}

function findSpecialtyEvidenceToken(ocrTokens) {
  let best = null;
  for (const detected of ocrTokens) {
    const score = SPECIALTY_CLASS_TERMS.has(detected)
      ? 1
      : SPIRITS_EVIDENCE_TERMS.has(detected)
        ? 0.66
        : SPECIALTY_EVIDENCE_TERMS.has(detected)
          ? 0.82
          : 0;
    if (score && (!best || score > best.score)) best = { detected, score };
  }
  return best;
}

function bestTokenMatch(expected, ocrTokens) {
  let best = null;
  for (const detected of ocrTokens) {
    const score = similarityScore(expected, detected);
    if (!best || score > best.score) best = { expected, detected, score };
  }
  return best;
}

function minimumTokenScore(token) {
  if (token.length <= 3) return 0.85;
  if (token.length <= 5) return 0.72;
  return 0.68;
}

function significantTokens(text = '') {
  const ignored = new Set(['A', 'AN', 'AND', 'BY', 'FOR', 'OF', 'THE', 'WITH']);
  return tokenizeForMatch(text).filter((token) => token.length > 1 && !ignored.has(token));
}
