import { findBestTextCandidate } from '../extraction/candidate-search.js';
import { makeReview, SEVERITY, STATUS } from './status.js';

export function validateOptionalTextField(field, expected, ocrResult, { passThreshold = 0.88, reviewThreshold = 0.68 } = {}) {
  if (!expected) return null;
  const candidate = findBestTextCandidate(expected, ocrResult, { slack: 4 });
  if (!candidate || candidate.score < 0.42) {
    return makeReview({
      field,
      expected,
      status: STATUS.NOT_FOUND,
      severity: SEVERITY.WARNING,
      reason: `${field} was entered but not found in the label text.`,
    });
  }
  if (candidate.score >= passThreshold) {
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
  if (candidate.score >= reviewThreshold) {
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
  return makeReview({
    field,
    expected,
    extracted: candidate.evidence,
    status: STATUS.FAIL,
    severity: SEVERITY.WARNING,
    confidence: candidate.score,
    reason: `${field} evidence does not match the expected value.`,
    evidence: candidate,
  });
}
