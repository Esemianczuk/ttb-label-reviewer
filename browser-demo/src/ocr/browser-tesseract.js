import { createWorker, PSM } from 'tesseract.js';
import { createOcrResult } from './ocr-types.js';

const TESSERACT_VERSION = '7.0.0';
const CORE_VERSION = '7.0.0';
const DEFAULT_CONFIDENCE = 0.75;

let workerPromise = null;
let assetConfigPromise = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rectangleFromFractions(width, height, { x, y, w, h }) {
  const left = clamp(Math.round(x * width), 0, width - 1);
  const top = clamp(Math.round(y * height), 0, height - 1);
  return {
    left,
    top,
    width: clamp(Math.round(w * width), 1, width - left),
    height: clamp(Math.round(h * height), 1, height - top),
  };
}

async function dimensionsForBlob(blob) {
  if ('createImageBitmap' in globalThis) {
    const bitmap = await createImageBitmap(blob);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return dimensions;
  }

  if (typeof Image === 'undefined') {
    throw new Error('This browser worker cannot decode image dimensions.');
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function colaSheetVariants(width, height) {
  return [
    {
      id: 'application-top',
      label: 'Top application fields',
      psm: PSM.SPARSE_TEXT,
      rectangle: rectangleFromFractions(width, height, { x: 0.0, y: 0.06, w: 0.74, h: 0.31 }),
    },
    {
      id: 'product-info',
      label: 'Application product fields',
      psm: PSM.SPARSE_TEXT,
      rectangle: rectangleFromFractions(width, height, { x: 0.0, y: 0.29, w: 0.39, h: 0.28 }),
    },
    {
      id: 'application-left',
      label: 'Application summary',
      psm: PSM.AUTO,
      rectangle: rectangleFromFractions(width, height, { x: 0.0, y: 0.12, w: 0.39, h: 0.82 }),
    },
    {
      id: 'label-area',
      label: 'Label image area',
      psm: PSM.SPARSE_TEXT,
      rectangle: rectangleFromFractions(width, height, { x: 0.38, y: 0.12, w: 0.61, h: 0.86 }),
    },
    {
      id: 'lower-label-strip',
      label: 'Lower label strip',
      psm: PSM.SPARSE_TEXT,
      rectangle: rectangleFromFractions(width, height, { x: 0.0, y: 0.38, w: 1.0, h: 0.6 }),
    },
    {
      id: 'warning-right',
      label: 'Right warning text',
      psm: PSM.SINGLE_BLOCK,
      rectangle: rectangleFromFractions(width, height, { x: 0.7, y: 0.38, w: 0.28, h: 0.36 }),
    },
    {
      id: 'warning-lower-middle',
      label: 'Lower middle warning text',
      psm: PSM.SINGLE_BLOCK,
      rectangle: rectangleFromFractions(width, height, { x: 0.3, y: 0.55, w: 0.35, h: 0.38 }),
    },
    {
      id: 'warning-seltzer-back',
      label: 'Can back warning text',
      psm: PSM.SINGLE_BLOCK,
      rectangle: rectangleFromFractions(width, height, { x: 0.58, y: 0.48, w: 0.28, h: 0.18 }),
    },
  ];
}

function normalizeLine(line, index, variantId) {
  const text = String(line.text || '').trim();
  if (!text) return null;
  const bbox = line.bbox
    ? {
        x: line.bbox.x0,
        y: line.bbox.y0,
        width: Math.max(1, line.bbox.x1 - line.bbox.x0),
        height: Math.max(1, line.bbox.y1 - line.bbox.y0),
      }
    : null;
  return {
    text,
    confidence: Number.isFinite(line.confidence) ? line.confidence / 100 : DEFAULT_CONFIDENCE,
    bbox,
    variantId,
    index,
  };
}

function lineBlocksFromTesseract(data, variantId) {
  const blocks = [];
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const normalized = normalizeLine(line, blocks.length, variantId);
        if (normalized) blocks.push(normalized);
      }
    }
  }
  return blocks;
}

function usefulLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /[a-z0-9]/i.test(line));
}

function mergeVariantText(variantResults) {
  const seen = new Set();
  const lines = [];
  for (const variant of variantResults) {
    for (const line of usefulLines(variant.rawText)) {
      const key = line.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
  }
  return lines.join('\n');
}

async function getWorker(onProgress) {
  if (!workerPromise) {
    const assetConfig = await resolveTesseractAssetConfig();
    workerPromise = createWorker('eng', 1, {
      workerPath: assetConfig.workerPath,
      corePath: assetConfig.corePath,
      langPath: assetConfig.langPath,
      cacheMethod: 'write',
      logger: (message) => {
        if (message.status && Number.isFinite(message.progress)) {
          onProgress?.(`${message.status} ${Math.round(message.progress * 100)}%`);
        }
      },
    }).then(async (worker) => {
      await worker.setParameters({
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      });
      worker.assetSourceNote = assetConfig.note;
      return worker;
    });
  }
  return workerPromise;
}

function baseUrl() {
  return import.meta.env.BASE_URL || '/';
}

function localTesseractAsset(path) {
  return `${baseUrl()}tesseract/${path}`.replace(/\/{2,}/g, '/');
}

async function localAssetExists(path) {
  if (!globalThis.fetch) return false;
  try {
    const response = await fetch(path, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

async function resolveTesseractAssetConfig() {
  if (!assetConfigPromise) {
    assetConfigPromise = (async () => {
      const localWorkerPath = localTesseractAsset('worker.min.js');
      const hasLocalWorker = await localAssetExists(localWorkerPath);
      if (hasLocalWorker) {
        return {
          workerPath: localWorkerPath,
          corePath: localTesseractAsset('core'),
          langPath: localTesseractAsset('lang'),
          note: 'Tesseract.js OCR assets loaded from packaged local files.',
          usesCdnFallback: false,
        };
      }

      return {
        workerPath: `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`,
        corePath: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${CORE_VERSION}`,
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        note:
          'Development fallback: Tesseract.js engine assets were loaded from public CDNs; uploaded images are still processed locally in this browser session.',
        usesCdnFallback: true,
      };
    })();
  }
  return assetConfigPromise;
}

export async function recognizeImageInBrowser(fileOrBlob, { onProgress } = {}) {
  const startedAt = performance.now();
  onProgress?.('Preparing browser OCR...');
  const [worker, dimensions, assetConfig] = await Promise.all([
    getWorker(onProgress),
    dimensionsForBlob(fileOrBlob),
    resolveTesseractAssetConfig(),
  ]);
  const variants = colaSheetVariants(dimensions.width, dimensions.height);
  const blocks = [];
  const variantResults = [];

  for (const variant of variants) {
    onProgress?.(`Reading ${variant.label}...`);
    await worker.setParameters({ tessedit_pageseg_mode: variant.psm });
    const variantStartedAt = performance.now();
    const { data } = await worker.recognize(fileOrBlob, { rectangle: variant.rectangle }, { text: true, blocks: true });
    const durationMs = Math.round(performance.now() - variantStartedAt);
    const rawText = data.text || '';
    const variantBlocks = lineBlocksFromTesseract(data, variant.id);
    blocks.push(...variantBlocks);
    variantResults.push({
      id: variant.id,
      label: variant.label,
      rawText,
      score: usefulLines(rawText).length,
      textLength: rawText.trim().length,
      lineCount: variantBlocks.length,
      durationMs,
    });
  }

  const rawText = mergeVariantText(variantResults);
  return createOcrResult({
    engine: 'tesseract-js-browser',
    rawText,
    blocks,
    processingTimeMs: Math.round(performance.now() - startedAt),
    preprocessingNotes: [
      'Browser-only Tesseract.js OCR',
      'Preset: COLA sheet product/application/label crops',
      `${dimensions.width}x${dimensions.height} source image`,
      assetConfig.note,
    ],
    warnings: [
      ...(rawText.trim() ? [] : ['Tesseract.js returned no text for this image.']),
      ...(assetConfig.usesCdnFallback
        ? ['OCR engine assets used a CDN fallback. Uploaded image bytes were not sent to the CDN by this app.']
        : []),
    ],
    source: 'browser-tesseract',
    variants: variantResults,
    imageSize: [dimensions.width, dimensions.height],
  });
}
