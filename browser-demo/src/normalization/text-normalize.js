import levenshtein from 'fast-levenshtein';

const CURLY_QUOTES = /[\u2018\u2019\u201A\u201B\u2032]/g;
const CURLY_DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033]/g;
const DECORATIVE_PUNCTUATION = /[^\p{Letter}\p{Number}%./&+ -]/gu;

export function normalizeWhitespace(text = '') {
  return String(text).replace(/\s+/g, ' ').trim();
}

export function normalizeQuotes(text = '') {
  return String(text).replace(CURLY_QUOTES, "'").replace(CURLY_DOUBLE_QUOTES, '"');
}

export function normalizeCase(text = '') {
  return String(text).toLocaleUpperCase('en-US');
}

export function removeDecorativePunctuation(text = '') {
  return normalizeQuotes(text)
    .replace(DECORATIVE_PUNCTUATION, ' ')
    .replace(/[._:;,()[\]{}"']/g, ' ')
    .replace(/[-/]/g, ' ');
}

export function normalizeForFuzzyMatch(text = '') {
  return normalizeWhitespace(removeDecorativePunctuation(normalizeCase(text)));
}

export function normalizeForStrictWarning(text = '') {
  return normalizeWhitespace(
    normalizeQuotes(text)
      .replace(/\u00a0/g, ' ')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[^\p{Letter}\p{Number}().,:;'%/ -]/gu, ' ')
      .toLocaleUpperCase('en-US'),
  );
}

export function tokenizeForMatch(text = '') {
  return normalizeForFuzzyMatch(text).split(' ').filter(Boolean);
}

export function similarityScore(a = '', b = '') {
  const left = normalizeForFuzzyMatch(a);
  const right = normalizeForFuzzyMatch(b);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(0.98, Math.min(left.length, right.length) / Math.max(left.length, right.length) + 0.12);
  }
  const distance = levenshtein.get(left, right);
  return Math.max(0, 1 - distance / Math.max(left.length, right.length));
}

export function bestWindowSimilarity(needle = '', haystack = '', slack = 2) {
  const needleTokens = tokenizeForMatch(needle);
  const haystackTokens = tokenizeForMatch(haystack);
  if (!needleTokens.length || !haystackTokens.length) {
    return { score: 0, text: '' };
  }

  const normalizedNeedle = needleTokens.join(' ');
  const normalizedHaystack = haystackTokens.join(' ');
  if (normalizedHaystack.includes(normalizedNeedle)) {
    return { score: 1, text: needle };
  }

  let best = { score: 0, text: '' };
  const minSize = Math.max(1, needleTokens.length - slack);
  const maxSize = Math.min(haystackTokens.length, needleTokens.length + slack);

  for (let start = 0; start < haystackTokens.length; start += 1) {
    for (let size = minSize; size <= maxSize; size += 1) {
      const windowTokens = haystackTokens.slice(start, start + size);
      if (windowTokens.length < minSize) continue;
      const candidate = windowTokens.join(' ');
      const score = similarityScore(normalizedNeedle, candidate);
      if (score > best.score) {
        best = { score, text: candidate };
      }
    }
  }

  return best;
}

export function splitLines(text = '') {
  return String(text)
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}
