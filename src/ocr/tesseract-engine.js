import { createWorker, PSM } from 'tesseract.js';
import { flattenOcrBlocks } from '../extraction/candidate-search.js';
import { preprocessImageVariantsForOcr } from '../preprocessing/image-preprocess.js';
import { createOcrResult } from './ocr-types.js';

const workerSlots = [];

function assetPath(path) {
  return `${import.meta.env.BASE_URL}${path}`.replace(/\/{2,}/g, '/').replace(':/', '://');
}

function describeProgress(message) {
  if (!message) return 'Reading text...';
  if (message.status === 'loading tesseract core') return 'Loading OCR engine...';
  if (message.status === 'loading language traineddata') return 'Loading English OCR data...';
  if (message.status === 'initializing api') return 'Initializing OCR...';
  if (message.status === 'recognizing text') {
    const pct = Number.isFinite(message.progress) ? ` ${Math.round(message.progress * 100)}%` : '';
    return `Reading text${pct}...`;
  }
  return `${message.status || 'OCR'}...`;
}

function psmForVariant(variant) {
  return {
    auto: PSM.AUTO,
    singleBlock: PSM.SINGLE_BLOCK,
    sparseText: PSM.SPARSE_TEXT,
    singleColumn: PSM.SINGLE_COLUMN,
  }[variant.psm] || PSM.SINGLE_BLOCK;
}

function scoreOcrText(text = '') {
  const normalized = text.toUpperCase();
  const keywordMatches = [
    'GOVERNMENT',
    'WARNING',
    'SURGEON',
    'PREGNANCY',
    'BIRTH',
    'DEFECT',
    'CONSUMPTION',
    'ALCOHOL',
    'BEVERAGE',
    'MACHINERY',
    'HEALTH',
    'PROOF',
    'ALC',
    'VOL',
    'ML',
    'TEQUILA',
    'CUERVO',
    'ESPECIAL',
    'AGAVE',
    'BOURBON',
    'WHISKEY',
    'DISTILL',
    'MEXICO',
    'UNITED',
  ].filter((keyword) => normalized.includes(keyword)).length;
  const alphanumericCount = (normalized.match(/[A-Z0-9]/g) || []).length;
  return keywordMatches * 80 + Math.min(alphanumericCount, 900);
}

function usefulLines(text = '') {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => /[A-Za-z0-9]/.test(line))
    .filter((line) => line.length > 1);
}

function mergeVariantTexts(variantResults) {
  const seen = new Set();
  const lines = [];
  const sorted = [...variantResults]
    .filter((result) => result.rawText.trim())
    .sort((left, right) => right.score - left.score);

  for (const result of sorted) {
    for (const line of usefulLines(result.rawText)) {
      const key = line.toUpperCase().replace(/[^A-Z0-9%]+/g, ' ').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
  }

  return lines.join('\n');
}

function ensureWorkerSlot(slotIndex) {
  if (window.location.protocol === 'file:') {
    throw new Error('Browser OCR workers need the app to be served over http://localhost. Use npm run dev or npm run preview for OCR. The bundled sample fixture still works locally.');
  }

  if (!workerSlots[slotIndex]) {
    const slot = {
      onProgress: null,
      workerPromise: null,
    };
    slot.workerPromise = createWorker('eng', 1, {
      workerPath: assetPath('tesseract/worker.min.js'),
      corePath: assetPath('tesseract-core'),
      langPath: assetPath('tessdata'),
      gzip: true,
      logger: (message) => slot.onProgress?.(describeProgress(message)),
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: '1',
      });
      return worker;
    });
    workerSlots[slotIndex] = slot;
  }

  return workerSlots[slotIndex];
}

async function getWorker(slotIndex, onProgress) {
  const slot = ensureWorkerSlot(slotIndex);
  slot.onProgress = onProgress;
  return { slot, worker: await slot.workerPromise };
}

export function getRecommendedWorkerCount(jobCount) {
  const cores = navigator.hardwareConcurrency || 4;
  const laptopFriendlyLimit = cores >= 4 ? 2 : 1;
  return Math.max(1, Math.min(jobCount || 1, laptopFriendlyLimit));
}

export async function recognizeImage(fileOrBlob, { onProgress, workerSlot = 0 } = {}) {
  const startedAt = performance.now();
  onProgress?.('Preparing OCR variants...');
  const preprocessed = await preprocessImageVariantsForOcr(fileOrBlob);
  const { slot, worker } = await getWorker(workerSlot, onProgress);
  try {
    const variantResults = [];
    const blocks = [];

    for (const [index, variant] of preprocessed.variants.entries()) {
      onProgress?.(`Reading ${variant.label} (${index + 1}/${preprocessed.variants.length})...`);
      await worker.setParameters({
        tessedit_pageseg_mode: psmForVariant(variant),
        preserve_interword_spaces: '1',
      });
      const response = await worker.recognize(variant.canvas, {}, { text: true, blocks: true });
      const rawText = response?.data?.text || '';
      const variantBlocks = flattenOcrBlocks({
        blocks: response?.data?.blocks || [],
        rawText,
      }).map((block) => ({
        ...block,
        variantId: variant.id,
      }));
      blocks.push(...variantBlocks);
      variantResults.push({
        id: variant.id,
        label: variant.label,
        psm: variant.psm,
        rawText,
        score: scoreOcrText(rawText),
        textLength: rawText.trim().length,
        lineCount: usefulLines(rawText).length,
        preprocessingNotes: variant.preprocessingNotes,
      });
    }

    const rawText = mergeVariantTexts(variantResults);
    const allNotes = variantResults.flatMap((result) => result.preprocessingNotes);
    const bestVariant = [...variantResults].sort((left, right) => right.score - left.score)[0];

    return createOcrResult({
      engine: 'tesseract-js',
      rawText,
      blocks,
      processingTimeMs: Math.round(performance.now() - startedAt),
      preprocessingNotes: [
        `Enhanced OCR used ${variantResults.length} preprocessing variants`,
        bestVariant ? `Best variant: ${bestVariant.label}` : '',
        ...new Set(allNotes),
      ].filter(Boolean),
      warnings: rawText.trim() ? [] : ['OCR returned no text for this image after enhanced preprocessing.'],
      source: 'ocr',
      variants: variantResults,
    });
  } finally {
    slot.onProgress = null;
  }
}

export async function terminateOcrWorker() {
  await Promise.all(
    workerSlots.map(async (slot) => {
      if (!slot?.workerPromise) return;
      const worker = await slot.workerPromise;
      await worker.terminate();
    }),
  );
  workerSlots.length = 0;
}
