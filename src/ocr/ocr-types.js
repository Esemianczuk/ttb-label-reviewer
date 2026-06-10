import { APP_VERSION } from '../app-state.js';
import { normalizeWhitespace, splitLines } from '../normalization/text-normalize.js';

export function blocksFromText(rawText, confidence = 0.98) {
  return splitLines(rawText).map((text, index) => ({
    text,
    confidence,
    bbox: null,
    index,
  }));
}

export function createOcrResult({
  engine = 'tesseract-js',
  rawText = '',
  blocks = [],
  processingTimeMs = 0,
  preprocessingNotes = [],
  warnings = [],
  source = 'ocr',
}) {
  const normalizedBlocks = blocks.length ? blocks : blocksFromText(rawText, null);
  return {
    engine,
    rawText: normalizeWhitespace(rawText).includes('\n') ? rawText : String(rawText || ''),
    blocks: normalizedBlocks,
    processingTimeMs,
    preprocessingNotes,
    warnings,
    source,
    appVersion: APP_VERSION,
  };
}

export function combineOcrResults(results = []) {
  const blocks = [];
  const rawChunks = [];
  let processingTimeMs = 0;
  const notes = [];
  const warnings = [];

  for (const result of results) {
    if (!result) continue;
    rawChunks.push(result.rawText || '');
    blocks.push(...(result.blocks || []));
    processingTimeMs += result.processingTimeMs || 0;
    notes.push(...(result.preprocessingNotes || []));
    warnings.push(...(result.warnings || []));
  }

  return createOcrResult({
    engine: results.map((result) => result?.engine).filter(Boolean).join('+') || 'combined',
    rawText: rawChunks.filter(Boolean).join('\n\n--- next label image ---\n\n'),
    blocks,
    processingTimeMs,
    preprocessingNotes: [...new Set(notes)],
    warnings: [...new Set(warnings)],
    source: 'combined',
  });
}
