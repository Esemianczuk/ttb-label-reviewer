import { GOVERNMENT_WARNING_TEXT } from '../app-state.js';
import { bestWindowSimilarity, normalizeForStrictWarning, normalizeWhitespace, splitLines } from '../normalization/text-normalize.js';
import { makeReview, SEVERITY, STATUS } from './status.js';

const WARNING_EVIDENCE_MAX_LENGTH = 520;

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
  const evidenceText = governmentWarningEvidenceText(rawText, segmentResults, reviewSegments);

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

  if (normalizedText.includes('GOVERNMENT WARNING')) {
    return makeReview({
      field,
      expected: GOVERNMENT_WARNING_TEXT,
      extracted: evidenceText || 'Government warning heading detected',
      status: STATUS.NEEDS_REVIEW,
      severity: SEVERITY.WARNING,
      confidence: Math.max(0.35, reviewSegments.length / REQUIRED_WARNING_SEGMENTS.length),
      reason: 'Government warning heading was found, but OCR did not confidently detect enough of the small legal text.',
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

function governmentWarningEvidenceText(rawText, segmentResults, reviewSegments) {
  return limitEvidenceText(
    warningExcerptFromRawText(rawText) ||
      reviewSegments.map((item) => item.evidence).filter(Boolean).join(' / ') ||
      segmentResults.filter((item) => item.score > 0.45).map((item) => item.evidence).filter(Boolean).join(' / '),
  );
}

function warningExcerptFromRawText(rawText) {
  const lines = splitLines(rawText);
  const headingIndex = lines.findIndex((line) => normalizeForStrictWarning(line).includes('GOVERNMENT WARNING'));
  if (headingIndex >= 0) {
    return normalizeWhitespace(lines.slice(headingIndex, headingIndex + 6).join(' '));
  }

  const normalizedRaw = normalizeForStrictWarning(rawText);
  const headingAt = normalizedRaw.indexOf('GOVERNMENT WARNING');
  if (headingAt < 0) return '';
  return normalizeWhitespace(normalizedRaw.slice(headingAt, headingAt + WARNING_EVIDENCE_MAX_LENGTH));
}

function limitEvidenceText(text) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= WARNING_EVIDENCE_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, WARNING_EVIDENCE_MAX_LENGTH - 3).trim()}...`;
}
