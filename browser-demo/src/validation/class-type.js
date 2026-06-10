import { findBestTextCandidate, scoreExpectedTokenCoverage } from '../extraction/candidate-search.js';
import { makeReview, SEVERITY, STATUS } from './status.js';

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
  const bestEvidence = tokenCoverage && (!candidate || tokenCoverage.score > candidate.score) ? tokenCoverage : candidate;

  if (!bestEvidence || (bestEvidence.score < 0.42 && (!tokenCoverage || tokenCoverage.coverage < 0.5))) {
    return makeReview({
      field,
      expected,
      status: STATUS.NOT_FOUND,
      severity: SEVERITY.CRITICAL,
      reason: 'Expected class/type was not found in the label text.',
    });
  }

  if (candidate?.score >= 0.9 || (tokenCoverage?.coverage === 1 && tokenCoverage.score >= 0.92)) {
    const evidence = candidate?.score >= 0.9 ? candidate : tokenCoverage;
    return makeReview({
      field,
      expected,
      extracted: evidence.value || evidence.evidence,
      status: STATUS.PASS,
      confidence: evidence.score,
      reason: 'Expected class/type appears on the label.',
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
