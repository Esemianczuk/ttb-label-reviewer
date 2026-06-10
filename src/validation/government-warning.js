import { GOVERNMENT_WARNING_TEXT } from '../app-state.js';
import { bestWindowSimilarity, normalizeForStrictWarning } from '../normalization/text-normalize.js';
import { makeReview, SEVERITY, STATUS } from './status.js';

export const REQUIRED_WARNING_SEGMENTS = [
  'GOVERNMENT WARNING',
  'According to the Surgeon General',
  'women should not drink alcoholic beverages during pregnancy',
  'risk of birth defects',
  'Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery',
  'may cause health problems',
];

export function validateGovernmentWarning(required, ocrResult) {
  const field = 'Government Warning';
  if (!required) {
    return makeReview({
      field,
      expected: 'Not required for this review',
      status: STATUS.WARNING,
      severity: SEVERITY.WARNING,
      reason: 'Government warning was marked as not required in the expected fields.',
    });
  }

  const rawText = ocrResult?.rawText || '';
  const normalizedText = normalizeForStrictWarning(rawText);
  const segmentResults = REQUIRED_WARNING_SEGMENTS.map((segment) => {
    const normalizedSegment = normalizeForStrictWarning(segment);
    if (normalizedText.includes(normalizedSegment)) {
      return { segment, score: 1, evidence: segment };
    }
    const best = bestWindowSimilarity(segment, rawText, 4);
    return { segment, score: best.score, evidence: best.text };
  });

  const strongSegments = segmentResults.filter((segment) => segment.score >= 0.9);
  const reviewSegments = segmentResults.filter((segment) => segment.score >= 0.76);
  const lowest = segmentResults.reduce((min, current) => (current.score < min.score ? current : min), segmentResults[0]);
  const evidenceText = normalizedText.includes('GOVERNMENT WARNING') ? 'Government warning text detected' : reviewSegments.map((item) => item.evidence).filter(Boolean).join(' / ');

  if (strongSegments.length === REQUIRED_WARNING_SEGMENTS.length) {
    return makeReview({
      field,
      expected: GOVERNMENT_WARNING_TEXT,
      extracted: evidenceText || 'Required warning text appears present',
      status: STATUS.PASS,
      confidence: Math.min(...segmentResults.map((segment) => segment.score)),
      reason: 'Required government warning text appears to be present.',
      evidence: { text: evidenceText, method: 'required-segment-check', segments: segmentResults },
    });
  }

  if (reviewSegments.length >= 4) {
    return makeReview({
      field,
      expected: GOVERNMENT_WARNING_TEXT,
      extracted: evidenceText,
      status: STATUS.NEEDS_REVIEW,
      severity: SEVERITY.WARNING,
      confidence: reviewSegments.length / REQUIRED_WARNING_SEGMENTS.length,
      reason: 'Warning heading and several required phrases were found, but OCR did not confidently detect the full text.',
      evidence: { text: evidenceText, method: 'required-segment-check', segments: segmentResults },
    });
  }

  return makeReview({
    field,
    expected: GOVERNMENT_WARNING_TEXT,
    extracted: evidenceText,
    status: STATUS.FAIL,
    severity: SEVERITY.CRITICAL,
    confidence: lowest?.score ?? 0,
    reason: 'Required government warning was not found or major required phrases are missing.',
    evidence: { text: evidenceText, method: 'required-segment-check', segments: segmentResults },
  });
}
