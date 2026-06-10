import { findRegexCandidates } from '../extraction/candidate-search.js';
import { netContentsEquivalent, parseNetContents } from '../normalization/units-normalize.js';
import { makeReview, SEVERITY, STATUS } from './status.js';

const NET_CONTENTS_PATTERN = /(?:\d{1,5}(?:\.\d+)?\s*M\s*L\b|(?:7\s*\/?\s*[5S]\s*[0O]|\/\s*[5S]\s*[0O]|T\s*[5S]\s*[0O])\s*M?\s*L\b|\d{1,4}(?:\.\d+)?\s*(?:L|LITER|LITRE|LITERS|LITRES)\b)/gi;
const AMBIGUOUS_ML_PATTERN = /\bM\s*L\b/i;

export function validateNetContents(expected, ocrResult) {
  const field = 'Net Contents';
  const expectedParsed = parseNetContents(expected);
  if (!expectedParsed) {
    return makeReview({
      field,
      expected,
      status: STATUS.WARNING,
      severity: SEVERITY.WARNING,
      reason: 'Expected net contents could not be parsed.',
    });
  }

  const candidates = findRegexCandidates(NET_CONTENTS_PATTERN, ocrResult, {
    method: 'regex-net-contents-candidate',
  })
    .map((candidate) => ({ ...candidate, parsed: parseNetContents(candidate.evidence) }))
    .filter((candidate) => candidate.parsed);

  if (!candidates.length) {
    const ambiguousMlEvidence = findRegexCandidates(AMBIGUOUS_ML_PATTERN, ocrResult, {
      method: 'ambiguous-net-contents-candidate',
    })[0];

    if (ambiguousMlEvidence) {
      return makeReview({
        field,
        expected,
        extracted: ambiguousMlEvidence.evidence,
        status: STATUS.NEEDS_REVIEW,
        severity: SEVERITY.WARNING,
        confidence: ambiguousMlEvidence.confidence,
        reason: 'OCR found milliliter evidence, but the amount could not be read confidently.',
        evidence: ambiguousMlEvidence,
      });
    }

    return makeReview({
      field,
      expected,
      status: STATUS.NOT_FOUND,
      severity: SEVERITY.CRITICAL,
      reason: 'No net contents evidence was found on the label.',
    });
  }

  const passing = candidates.find((candidate) => netContentsEquivalent(expectedParsed, candidate.parsed));
  if (passing) {
    return makeReview({
      field,
      expected,
      extracted: passing.evidence,
      status: STATUS.PASS,
      confidence: passing.confidence,
      reason: 'Expected net contents match the label evidence.',
      evidence: passing,
    });
  }

  const first = candidates[0];
  return makeReview({
    field,
    expected,
    extracted: first.evidence,
    status: STATUS.FAIL,
    severity: SEVERITY.CRITICAL,
    confidence: first.confidence,
    reason: `Expected ${expectedParsed.amountMl} mL, but label evidence appears to show ${first.parsed.amountMl} mL.`,
    evidence: first,
  });
}
