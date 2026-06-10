import { findBestTextCandidate } from '../extraction/candidate-search.js';
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
  if (!candidate || candidate.score < 0.42) {
    return makeReview({
      field,
      expected,
      status: STATUS.NOT_FOUND,
      severity: SEVERITY.CRITICAL,
      reason: 'Expected class/type was not found in the label text.',
    });
  }

  if (candidate.score >= 0.9) {
    return makeReview({
      field,
      expected,
      extracted: candidate.evidence,
      status: STATUS.PASS,
      confidence: candidate.score,
      reason: 'Expected class/type appears on the label.',
      evidence: candidate,
    });
  }

  if (candidate.score >= 0.72) {
    return makeReview({
      field,
      expected,
      extracted: candidate.evidence,
      status: STATUS.NEEDS_REVIEW,
      severity: SEVERITY.WARNING,
      confidence: candidate.score,
      reason: 'A related class/type phrase was found, but it is not a confident exact match.',
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
    reason: 'The closest detected class/type text does not match the expected value.',
    evidence: candidate,
  });
}
