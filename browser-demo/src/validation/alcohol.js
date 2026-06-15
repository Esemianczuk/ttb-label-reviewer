import { findRegexCandidates } from '../extraction/candidate-search.js';
import { alcoholValuesEquivalent, parseAlcoholContent } from '../normalization/alcohol-normalize.js';
import { makeReview, SEVERITY, STATUS } from './status.js';

const ALCOHOL_CANDIDATE_PATTERN =
  /(?:ALC(?:OHOL)?\.?(?:\s+|[,;:]\s*)[0-9I1|lOBH%]{1,5}\s*(?:%\s*)?(?:(?:BY|B[YV]|RY)\s*)?V[O0C]?[L1I]?|\d{1,3}(?:[\.,]\d+)?\s*%\s*(?:ALC(?:OHOL)?\.?\s*(?:BY\s*)?(?:VOL(?:UME)?\.?|[/I1|]?\s*V[O0]L(?:UME)?\.?)|ABV)?|\d{1,3}(?:[\.,]\d+)?\s*(?:ALC(?:OHOL)?\.?\s*(?:BY\s*)?(?:VOL(?:UME)?\.?|[/I1|]?\s*V[O0]L(?:UME)?\.?)|ALC\s*[/I1|]?\s*V[O0]L|ALCIV[O0]L|ABV)|\d{2,3}(?:\.\d+)?\s*PROOF)/gi;

export function validateAlcohol(expected, ocrResult) {
  const field = 'Alcohol Content';
  const expectedParsed = parseAlcoholContent(expected);
  if (!expectedParsed) {
    return makeReview({
      field,
      expected,
      status: STATUS.WARNING,
      severity: SEVERITY.WARNING,
      reason: 'Expected alcohol content could not be parsed.',
    });
  }

  const candidates = findRegexCandidates(ALCOHOL_CANDIDATE_PATTERN, ocrResult, {
    method: 'regex-alcohol-candidate',
  })
    .map((candidate) => ({ ...candidate, parsed: parseAlcoholContent(candidate.value) || parseAlcoholContent(candidate.evidence) }))
    .filter((candidate) => candidate.parsed);

  if (!candidates.length) {
    return makeReview({
      field,
      expected,
      status: STATUS.NOT_FOUND,
      severity: SEVERITY.CRITICAL,
      reason: 'No alcohol content evidence was found on the label.',
    });
  }

  const passing = candidates.find((candidate) => alcoholValuesEquivalent(expectedParsed, candidate.parsed));
  if (passing) {
    return makeReview({
      field,
      expected,
      extracted: passing.evidence,
      status: STATUS.PASS,
      confidence: passing.confidence,
      reason: 'Expected alcohol content matches the label evidence.',
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
    reason: `Expected ABV ${expectedParsed.abvPercent}%, but label evidence appears to show ${first.parsed.abvPercent}%.`,
    evidence: first,
  });
}
