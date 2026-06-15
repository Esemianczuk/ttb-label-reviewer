import { findBestTextCandidate, scoreExpectedTokenCoverage } from '../extraction/candidate-search.js';
import { similarityScore, tokenizeForMatch } from '../normalization/text-normalize.js';
import { makeReview, SEVERITY, STATUS } from './status.js';

export function validateOptionalTextField(field, expected, ocrResult, { passThreshold = 0.88, reviewThreshold = 0.68 } = {}) {
  if (!expected) return null;
  const candidate = findBestTextCandidate(expected, ocrResult, { slack: 4 });
  const tokenCoverage = scoreExpectedTokenCoverage(expected, ocrResult);
  const countryEvidence = field === 'Country of Origin' ? findCountryOriginEvidence(expected, ocrResult) : null;
  const bestEvidence = tokenCoverage && (!candidate || tokenCoverage.score > candidate.score) ? tokenCoverage : candidate;

  if (countryEvidence) {
    return makeReview({
      field,
      expected,
      extracted: countryEvidence.value,
      status: STATUS.PASS,
      confidence: countryEvidence.score,
      reason: 'Country of origin is corroborated by label evidence.',
      evidence: countryEvidence,
    });
  }

  if (!bestEvidence || bestEvidence.score < 0.42) {
    return makeReview({
      field,
      expected,
      status: STATUS.NOT_FOUND,
      severity: SEVERITY.WARNING,
      reason: `${field} was entered but not found in the label text.`,
    });
  }
  if (candidate?.score >= passThreshold) {
    return makeReview({
      field,
      expected,
      extracted: candidate.evidence,
      status: STATUS.PASS,
      confidence: candidate.score,
      reason: `${field} appears on the label.`,
      evidence: candidate,
    });
  }
  if (tokenCoverage?.coverage === 1 && tokenCoverage.score >= passThreshold) {
    return makeReview({
      field,
      expected,
      extracted: tokenCoverage.value,
      status: STATUS.PASS,
      confidence: tokenCoverage.score,
      reason: `${field} tokens appear on the label.`,
      evidence: tokenCoverage,
    });
  }
  if (candidate?.score >= reviewThreshold) {
    return makeReview({
      field,
      expected,
      extracted: candidate.evidence,
      status: STATUS.NEEDS_REVIEW,
      severity: SEVERITY.WARNING,
      confidence: candidate.score,
      reason: `${field} may appear on the label, but it needs review.`,
      evidence: candidate,
    });
  }
  if (tokenCoverage?.coverage >= 0.65 && tokenCoverage.score >= reviewThreshold) {
    return makeReview({
      field,
      expected,
      extracted: tokenCoverage.value,
      status: STATUS.NEEDS_REVIEW,
      severity: SEVERITY.WARNING,
      confidence: tokenCoverage.score,
      reason: `${field} tokens may appear on the label, but they need review.`,
      evidence: tokenCoverage,
    });
  }
  return makeReview({
    field,
    expected,
    extracted: bestEvidence.evidence,
    status: STATUS.FAIL,
    severity: SEVERITY.WARNING,
    confidence: bestEvidence.score,
    reason: `${field} evidence does not match the expected value.`,
    evidence: bestEvidence,
  });
}

function findCountryOriginEvidence(expected = '', ocrResult = {}) {
  let expectedTokens = significantTokens(expected).filter((token) => token.length >= 4 && !['UNITED', 'STATES'].includes(token));
  if (!expectedTokens.length) {
    expectedTokens = significantTokens(expected).filter((token) => token.length >= 4);
  }
  const ocrTokens = significantTokens(ocrResult.rawText || '');
  if (!expectedTokens.length || !ocrTokens.length) return null;
  const matches = expectedTokens.map((token) => bestTokenMatch(token, ocrTokens)).filter(Boolean);
  const matched = matches.filter((match) => match.score >= 0.88);
  if (!matched.length || matched.length / expectedTokens.length < 0.5) return null;
  const score = matched.reduce((sum, match) => sum + match.score, 0) / matched.length;
  const evidenceText = matched.map((match) => `${match.expected}:${match.detected}`).join(', ');
  return {
    value: evidenceText,
    evidence: evidenceText,
    score: Math.min(1, Math.max(score, 0.86)),
    coverage: matched.length / expectedTokens.length,
    confidence: null,
    block: null,
    method: 'country-origin-token-match',
    matches: matched,
  };
}

function bestTokenMatch(expected, ocrTokens) {
  let best = null;
  for (const detected of ocrTokens) {
    const score = similarityScore(expected, detected);
    if (!best || score > best.score) best = { expected, detected, score };
  }
  return best;
}

function significantTokens(text = '') {
  const ignored = new Set(['A', 'AN', 'AND', 'BY', 'FOR', 'OF', 'THE', 'WITH']);
  return tokenizeForMatch(text).filter((token) => token.length > 1 && !ignored.has(token));
}
