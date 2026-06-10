import {
  bestWindowSimilarity,
  normalizeForFuzzyMatch,
  normalizeWhitespace,
  similarityScore,
  splitLines,
  tokenizeForMatch,
} from '../normalization/text-normalize.js';

function blockText(block) {
  return normalizeWhitespace(block?.text || '');
}

export function flattenOcrBlocks(ocrResult = {}) {
  const output = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const text = blockText(node);
    if (text) {
      output.push({
        text,
        confidence: typeof node.confidence === 'number' ? node.confidence : null,
        bbox: node.bbox || null,
        variantBbox: node.variantBbox || null,
        variantId: node.variantId || '',
        imageId: node.imageId || '',
        imageName: node.imageName || '',
        imageUrl: node.imageUrl || '',
        imageIndex: Number.isFinite(node.imageIndex) ? node.imageIndex : null,
      });
    }
    for (const key of ['blocks', 'paragraphs', 'lines', 'words', 'symbols']) {
      if (Array.isArray(node[key])) node[key].forEach(visit);
    }
  };

  if (Array.isArray(ocrResult.blocks)) {
    ocrResult.blocks.forEach(visit);
  }

  return output;
}

export function getCandidateTexts(ocrResult = {}) {
  const blocks = flattenOcrBlocks(ocrResult);
  const lines = splitLines(ocrResult.rawText || '').map((text) => ({
    text,
    confidence: null,
    bbox: null,
  }));

  const seen = new Set();
  const candidates = [];
  for (const candidate of [...blocks, ...lines]) {
    const key = normalizeForFuzzyMatch(candidate.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
  }
  return candidates;
}

export function findBestTextCandidate(expectedValue, ocrResult, options = {}) {
  const expected = normalizeWhitespace(expectedValue);
  if (!expected) return null;

  const rawText = normalizeWhitespace(ocrResult?.rawText || '');
  const rawScore = bestWindowSimilarity(expected, rawText, options.slack ?? 3);
  let best = rawScore.score
    ? {
        value: rawScore.text || expected,
        evidence: rawScore.text || expected,
        score: rawScore.score,
        confidence: null,
        block: null,
        method: rawScore.score === 1 ? 'raw-text-contained-match' : 'raw-text-window-match',
      }
    : null;

  const candidates = getCandidateTexts(ocrResult);
  const expectedTokenCount = tokenizeForMatch(expected).length;
  const windows = [];

  for (const candidate of candidates) {
    windows.push(candidate);
    const tokens = tokenizeForMatch(candidate.text);
    const minSize = Math.max(1, expectedTokenCount - 1);
    const maxSize = Math.min(tokens.length, expectedTokenCount + 2);
    for (let start = 0; start < tokens.length; start += 1) {
      for (let size = minSize; size <= maxSize; size += 1) {
        const windowText = tokens.slice(start, start + size).join(' ');
        if (windowText) {
          windows.push({
            text: windowText,
            confidence: candidate.confidence,
            bbox: candidate.bbox,
            variantBbox: candidate.variantBbox,
            variantId: candidate.variantId,
            imageId: candidate.imageId,
            imageName: candidate.imageName,
            imageUrl: candidate.imageUrl,
            imageIndex: candidate.imageIndex,
          });
        }
      }
    }
  }

  for (const candidate of windows) {
    const score = similarityScore(expected, candidate.text);
    if (!best || score > best.score) {
      best = {
        value: candidate.text,
        evidence: candidate.text,
        score,
        confidence: candidate.confidence,
        block: candidate,
        method: 'fuzzy-expected-match',
      };
    }
  }

  return best;
}

function minimumTokenScore(token) {
  if (token.length <= 3) return 0.85;
  if (token.length <= 5) return 0.72;
  return 0.68;
}

function significantTokens(text = '') {
  const ignored = new Set(['A', 'AN', 'AND', 'BY', 'FOR', 'OF', 'THE', 'WITH']);
  return tokenizeForMatch(text).filter((token) => token.length > 1 && !ignored.has(token));
}

export function scoreExpectedTokenCoverage(expectedValue, ocrResult = {}) {
  const expectedTokens = significantTokens(expectedValue);
  const ocrTokens = significantTokens(ocrResult.rawText || '');
  if (!expectedTokens.length || !ocrTokens.length) return null;

  const matches = expectedTokens.map((expectedToken) => {
    let best = { expected: expectedToken, detected: '', score: 0 };
    for (const ocrToken of ocrTokens) {
      const score = similarityScore(expectedToken, ocrToken);
      if (score > best.score) {
        best = { expected: expectedToken, detected: ocrToken, score };
      }
    }
    return best;
  });

  const matched = matches.filter((match) => match.score >= minimumTokenScore(match.expected));
  const score = matches.reduce((sum, match) => sum + match.score, 0) / matches.length;
  const coverage = matched.length / expectedTokens.length;
  if (!coverage) return null;

  return {
    value: matched.map((match) => match.detected).join(' '),
    evidence: matches.map((match) => `${match.expected}:${match.detected || 'missing'}`).join(', '),
    score: Math.min(1, (score * 0.7) + (coverage * 0.3)),
    coverage,
    confidence: null,
    block: null,
    method: 'expected-token-coverage',
    matches,
  };
}

export function findRegexCandidates(regex, ocrResult, options = {}) {
  const sources = [
    ...getCandidateTexts(ocrResult).map((candidate) => ({ ...candidate, source: 'block' })),
    { text: ocrResult?.rawText || '', confidence: null, bbox: null, source: 'rawText' },
  ];
  const seen = new Set();
  const results = [];

  for (const source of sources) {
    const lines = options.matchWholeText ? [source.text] : splitLines(source.text);
    for (const line of lines) {
      const pattern = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
      for (const match of line.matchAll(pattern)) {
        const evidence = normalizeWhitespace(options.contextLine === false ? match[0] : line);
        const key = normalizeForFuzzyMatch(evidence);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        results.push({
          value: normalizeWhitespace(match[0]),
          evidence,
          score: 1,
          confidence: source.confidence,
          block: source,
          method: options.method || 'regex-candidate',
        });
      }
    }
  }

  return results;
}

export function findNearbyPhraseCandidates(pattern, ocrResult, options = {}) {
  const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
  return getCandidateTexts(ocrResult).filter((candidate) => regex.test(candidate.text)).map((candidate) => ({
    value: candidate.text,
    evidence: candidate.text,
    score: 1,
    confidence: candidate.confidence,
    block: candidate,
    method: options.method || 'nearby-phrase-candidate',
  }));
}
