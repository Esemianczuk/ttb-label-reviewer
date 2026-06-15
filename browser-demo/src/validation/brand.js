import { findBestTextCandidate, scoreExpectedTokenCoverage } from '../extraction/candidate-search.js';
import { hasEmbeddedAmbiguousGlyph, tokenizeForMatch } from '../normalization/text-normalize.js';
import { makeReview, SEVERITY, STATUS } from './status.js';

export function validateBrand(expected, ocrResult) {
  const field = 'Brand Name';
  if (!expected) {
    return makeReview({
      field,
      expected,
      status: STATUS.WARNING,
      severity: SEVERITY.WARNING,
      reason: 'No expected brand was entered.',
    });
  }

  const candidate = findBestTextCandidate(expected, ocrResult);
  const tokenCoverage = scoreExpectedTokenCoverage(expected, ocrResult);
  const bestEvidence = tokenCoverage && (!candidate || tokenCoverage.score > candidate.score) ? tokenCoverage : candidate;

  if (!bestEvidence || (bestEvidence.score < 0.45 && (!tokenCoverage || tokenCoverage.coverage < 0.5))) {
    return makeReview({
      field,
      expected,
      status: STATUS.NOT_FOUND,
      severity: SEVERITY.CRITICAL,
      reason: 'Expected brand name was not found in the label text.',
    });
  }

  const ambiguousExpectedBrand = hasEmbeddedAmbiguousGlyph(expected);

  if (candidate?.score >= 0.94 || (ambiguousExpectedBrand && candidate?.score >= 0.84)) {
    return makeReview({
      field,
      expected,
      extracted: candidate.evidence,
      status: STATUS.PASS,
      confidence: candidate.score,
      reason: ambiguousExpectedBrand && candidate.score < 0.94
        ? 'Expected brand name matches label evidence after treating the embedded punctuation mark as a stylized brand glyph.'
        : 'Expected brand name appears on the label.',
      evidence: candidate,
    });
  }

  const compound = findJoinedTokenEvidence(expected, ocrResult);
  if (compound?.score >= 0.9) {
    return makeReview({
      field,
      expected,
      extracted: compound.value,
      status: STATUS.PASS,
      confidence: compound.score,
      reason: 'Expected brand appears as joined label text.',
      evidence: compound,
    });
  }

  if (tokenCoverage?.coverage === 1 && tokenCoverage.score >= 0.9 && brandTokensAppearInOrder(expected, ocrResult)) {
    return makeReview({
      field,
      expected,
      extracted: tokenCoverage.value,
      status: STATUS.PASS,
      confidence: tokenCoverage.score,
      reason: 'Expected brand tokens appear on the label.',
      evidence: tokenCoverage,
    });
  }

  if (candidate?.score >= 0.7 || tokenCoverage?.coverage >= 0.8) {
    const evidence = candidate?.score >= 0.7 ? candidate : tokenCoverage;
    return makeReview({
      field,
      expected,
      extracted: evidence.value || evidence.evidence,
      status: STATUS.NEEDS_REVIEW,
      severity: SEVERITY.WARNING,
      confidence: evidence.score,
      reason:
        evidence.method === 'expected-token-coverage'
          ? 'Expected brand tokens were found across the OCR output, but not as one clean phrase.'
          : 'A close brand match was found, but OCR or spelling differences should be reviewed.',
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
    reason: 'The closest detected brand text does not match the expected brand.',
    evidence: bestEvidence,
  });
}

function brandTokensAppearInOrder(expected = '', ocrResult = {}) {
  const expectedTokens = significantTokens(expected);
  const ocrTokens = significantTokens(ocrResult.rawText || '');
  if (!expectedTokens.length || !ocrTokens.length) return false;
  let cursor = 0;
  for (const token of ocrTokens) {
    if (token === expectedTokens[cursor]) {
      cursor += 1;
      if (cursor === expectedTokens.length) return true;
    }
  }
  return false;
}

function findJoinedTokenEvidence(expected = '', ocrResult = {}) {
  const expectedTokens = significantTokens(expected);
  if (expectedTokens.length < 2) return null;
  const joinedExpected = expectedTokens.join('');
  if (joinedExpected.length < 5) return null;
  const matches = significantTokens(ocrResult.rawText || '').filter((token) => token.includes(joinedExpected));
  if (!matches.length) return null;
  const evidence = matches[0];
  const score = evidence === joinedExpected ? 0.94 : 0.9;
  return {
    value: evidence,
    evidence,
    score,
    confidence: null,
    block: null,
    method: 'joined-token-brand-match',
    matches: [{ expected: joinedExpected, detected: evidence, score }],
  };
}

function significantTokens(text = '') {
  const ignored = new Set(['A', 'AN', 'AND', 'BY', 'FOR', 'OF', 'THE', 'WITH']);
  return tokenizeForMatch(text).filter((token) => token.length > 1 && !ignored.has(token));
}
