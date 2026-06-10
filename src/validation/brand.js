import { findBestTextCandidate, scoreExpectedTokenCoverage } from '../extraction/candidate-search.js';
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

  if (candidate?.score >= 0.94) {
    return makeReview({
      field,
      expected,
      extracted: candidate.evidence,
      status: STATUS.PASS,
      confidence: candidate.score,
      reason: 'Expected brand name appears on the label.',
      evidence: candidate,
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
