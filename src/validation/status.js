export const STATUS = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  WARNING: 'WARNING',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  NOT_FOUND: 'NOT_FOUND',
  PASS_WITH_WARNINGS: 'PASS_WITH_WARNINGS',
};

export const SEVERITY = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
};

export function makeReview({
  field,
  expected,
  extracted = '',
  status,
  severity = SEVERITY.INFO,
  confidence = null,
  reason,
  evidence = null,
}) {
  return {
    field,
    expected: expected || '',
    extracted: extracted || '',
    status,
    severity,
    confidence,
    reason,
    evidence,
  };
}
