import { findBestTextCandidate } from '../extraction/candidate-search.js';
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
  if (!candidate || candidate.score < 0.45) {
    return makeReview({
      field,
      expected,
      status: STATUS.NOT_FOUND,
      severity: SEVERITY.CRITICAL,
      reason: 'Expected brand name was not found in the label text.',
    });
  }

  if (candidate.score >= 0.94) {
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

  if (candidate.score >= 0.8) {
    return makeReview({
      field,
      expected,
      extracted: candidate.evidence,
      status: STATUS.NEEDS_REVIEW,
      severity: SEVERITY.WARNING,
      confidence: candidate.score,
      reason: 'A close brand match was found, but OCR or spelling differences should be reviewed.',
      evidence: candidate,
    });
  }

  return makeReview({
    field,
    expected,
    extracted: candidate.evidence,
    status: STATUS.FAIL,
    severity: SEVERITY.CRITICAL,
    confidence: candidate.score,
    reason: 'The closest detected brand text does not match the expected brand.',
    evidence: candidate,
  });
}
