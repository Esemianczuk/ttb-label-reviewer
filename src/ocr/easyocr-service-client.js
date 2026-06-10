import { createOcrResult } from './ocr-types.js';

const DEFAULT_SERVICE_URL = 'http://127.0.0.1:8765';
const TARGET_VARIANT_SET = 'fast';

function serviceBaseUrl() {
  const configured = import.meta.env.VITE_EASYOCR_SERVICE_URL || DEFAULT_SERVICE_URL;
  return configured.replace(/\/+$/, '');
}

function normalizeBlocks(blocks = []) {
  return blocks
    .filter((block) => block?.text)
    .map((block, index) => ({
      text: String(block.text || ''),
      confidence: typeof block.confidence === 'number' ? block.confidence : null,
      bbox: block.bbox || null,
      variantId: block.variantId || '',
      index,
    }));
}

function normalizeVariants(variants = []) {
  return variants.map((variant) => ({
    id: variant.id || '',
    label: variant.label || variant.id || 'OCR variant',
    rawText: variant.rawText || '',
    score: Number(variant.score || 0),
    textLength: Number(variant.textLength || 0),
    lineCount: Number(variant.lineCount || 0),
  }));
}

async function readError(response) {
  try {
    const payload = await response.json();
    return payload.error || response.statusText;
  } catch {
    return response.statusText;
  }
}

function serviceUnavailableError() {
  return new Error('EasyOCR service is not reachable at 127.0.0.1:8765. Start it with npm run easyocr-service, then run the review again.');
}

export function getEasyOcrServiceUrl() {
  return serviceBaseUrl();
}

export function getRecommendedEasyOcrWorkerCount() {
  return 1;
}

export async function recognizeImageWithEasyOcr(fileOrBlob, { onProgress } = {}) {
  const startedAt = performance.now();
  onProgress?.('Sending image to EasyOCR...');

  const formData = new FormData();
  formData.set('image', fileOrBlob, fileOrBlob.name || 'label-image.jpg');
  formData.set('variant_set', TARGET_VARIANT_SET);

  let response;
  try {
    response = await fetch(`${serviceBaseUrl()}/ocr`, {
      method: 'POST',
      body: formData,
    });
  } catch {
    throw serviceUnavailableError();
  }

  if (!response.ok) {
    throw new Error(`EasyOCR service failed: ${await readError(response)}`);
  }

  onProgress?.('Receiving EasyOCR text...');
  const payload = await response.json();
  const rawText = payload.rawText || '';
  const elapsed = Number(payload.processingTimeMs || 0) || Math.round(performance.now() - startedAt);

  return createOcrResult({
    engine: payload.engine || 'easyocr-local',
    rawText,
    blocks: normalizeBlocks(payload.blocks),
    processingTimeMs: elapsed,
    preprocessingNotes: [
      `EasyOCR service ${payload.variantSet || TARGET_VARIANT_SET} variant set`,
      payload.requestedVariantSet ? `Requested variant set: ${payload.requestedVariantSet}` : '',
      ...(payload.preprocessingNotes || []),
    ].filter(Boolean),
    warnings: payload.warnings || (rawText.trim() ? [] : ['EasyOCR returned no text for this image.']),
    source: 'easyocr-service',
    variants: normalizeVariants(payload.variants),
  });
}
