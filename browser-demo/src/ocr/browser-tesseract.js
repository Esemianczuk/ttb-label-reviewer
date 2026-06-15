import { createWorker, PSM } from 'tesseract.js';
import { createOcrResult } from './ocr-types.js';

const TESSERACT_VERSION = '7.0.0';
const CORE_VERSION = '7.0.0';
const DEFAULT_CONFIDENCE = 0.75;
const CDN_FALLBACK_ENV = 'VITE_ALLOW_TESSERACT_CDN_FALLBACK';
const PREPROCESS_MAX_SCALE = 2.5;
const PREPROCESS_MAX_DIMENSION = 1800;
const ROTATED_EDGE_BAND_FRACTION = 0.22;

let workerPromise = null;
let assetConfigPromise = null;
let currentProgressCallback = null;
let currentVariantProgress = null;

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

function sourceScaleFor(width, height) {
  return Math.max(1, Math.min(PREPROCESS_MAX_SCALE, PREPROCESS_MAX_DIMENSION / Math.max(width, height)));
}

function variantRectangle(width, height, fractions) {
  return rectangleFromFractions(width, height, fractions);
}

function cropFromVariant(variant) {
  if (!variant?.rectangle || !variant?.source) return null;
  if (variant.source.crop) {
    return {
      x: variant.source.crop.x,
      y: variant.source.crop.y,
      width: variant.source.crop.width,
      height: variant.source.crop.height,
      unit: 'pixel',
      source: 'ocr',
    };
  }
  const scale = variant.source.scale || 1;
  return {
    x: Math.max(0, variant.rectangle.left / scale),
    y: Math.max(0, variant.rectangle.top / scale),
    width: Math.max(1, variant.rectangle.width / scale),
    height: Math.max(1, variant.rectangle.height / scale),
    unit: 'pixel',
    source: 'ocr',
  };
}

function variantProgressMeta(variant, variantIndex, totalVariants, progress = 0) {
  const safeTotal = Math.max(1, totalVariants || 1);
  const safeIndex = Math.max(0, variantIndex || 0);
  const safeProgress = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  return {
    phase: 'ocr-variant',
    variantId: variant.id,
    variantLabel: variant.label,
    variantIndex: safeIndex + 1,
    variantTotal: safeTotal,
    variantProgress: safeProgress,
    overallProgress: clamp((safeIndex + safeProgress) / safeTotal, 0, 1),
    psm: variant.psm,
    crop: cropFromVariant(variant),
  };
}

function emitProgress(onProgress, message, meta) {
  onProgress?.(message, meta);
}

function coverageVariantsForSource(source) {
  const full = { left: 0, top: 0, width: source.width, height: source.height };
  if (source.kind === 'rotated-edge') {
    return [
      {
        id: `${source.id}-upright-block`,
        label: source.label,
        psm: PSM.SINGLE_BLOCK,
        source,
        rectangle: full,
      },
      {
        id: `${source.id}-upright-sparse`,
        label: `${source.label} sparse text`,
        psm: PSM.SPARSE_TEXT,
        source,
        rectangle: full,
      },
    ];
  }

  if (source.kind === 'original') {
    return [
      {
        id: 'original-full-auto',
        label: 'Full label image',
        psm: PSM.AUTO,
        source,
        rectangle: full,
      },
      {
        id: 'original-full-sparse',
        label: 'Full label sparse text',
        psm: PSM.SPARSE_TEXT,
        source,
        rectangle: full,
      },
    ];
  }

  return [
    {
      id: `${source.id}-full-auto`,
      label: `${source.label} full label`,
      psm: PSM.AUTO,
      source,
      rectangle: full,
    },
    {
      id: `${source.id}-full-block`,
      label: `${source.label} dense label text`,
      psm: PSM.SINGLE_BLOCK,
      source,
      rectangle: full,
    },
    {
      id: `${source.id}-top-band`,
      label: `${source.label} top band`,
      psm: PSM.SPARSE_TEXT,
      source,
      rectangle: variantRectangle(source.width, source.height, { x: 0, y: 0, w: 1, h: 0.45 }),
    },
    {
      id: `${source.id}-middle-band`,
      label: `${source.label} middle band`,
      psm: PSM.SPARSE_TEXT,
      source,
      rectangle: variantRectangle(source.width, source.height, { x: 0, y: 0.25, w: 1, h: 0.5 }),
    },
    {
      id: `${source.id}-bottom-band`,
      label: `${source.label} bottom band`,
      psm: PSM.SPARSE_TEXT,
      source,
      rectangle: variantRectangle(source.width, source.height, { x: 0, y: 0.55, w: 1, h: 0.45 }),
    },
    {
      id: `${source.id}-left-band`,
      label: `${source.label} left band`,
      psm: PSM.SPARSE_TEXT,
      source,
      rectangle: variantRectangle(source.width, source.height, { x: 0, y: 0, w: 0.62, h: 1 }),
    },
    {
      id: `${source.id}-right-band`,
      label: `${source.label} right band`,
      psm: PSM.SPARSE_TEXT,
      source,
      rectangle: variantRectangle(source.width, source.height, { x: 0.38, y: 0, w: 0.62, h: 1 }),
    },
  ];
}

function thresholdVariantsForSource(source) {
  const full = { left: 0, top: 0, width: source.width, height: source.height };
  return [
    {
      id: `${source.id}-full-auto`,
      label: `${source.label} full label`,
      psm: PSM.AUTO,
      source,
      rectangle: full,
    },
    {
      id: `${source.id}-full-block`,
      label: `${source.label} dense label text`,
      psm: PSM.SINGLE_BLOCK,
      source,
      rectangle: full,
    },
    {
      id: `${source.id}-top-band`,
      label: `${source.label} top band`,
      psm: PSM.SPARSE_TEXT,
      source,
      rectangle: variantRectangle(source.width, source.height, { x: 0, y: 0, w: 1, h: 0.45 }),
    },
    {
      id: `${source.id}-bottom-band`,
      label: `${source.label} bottom band`,
      psm: PSM.SPARSE_TEXT,
      source,
      rectangle: variantRectangle(source.width, source.height, { x: 0, y: 0.55, w: 1, h: 0.45 }),
    },
  ];
}

function ocrVariantsForSources(sources) {
  const variants = [];
  for (const source of sources) {
    if (source.kind === 'threshold-inverted') {
      variants.push(...thresholdVariantsForSource(source));
    } else {
      variants.push(...coverageVariantsForSource(source));
    }
  }
  return variants;
}

function rotatedEdgeSourceDescriptors(width, height, scale) {
  const edgeWidth = Math.max(96, Math.round(width * ROTATED_EDGE_BAND_FRACTION));
  const regions = [
    { id: 'left-edge', label: 'Left vertical warning band', x: 0, y: 0, width: edgeWidth, height },
    {
      id: 'right-edge',
      label: 'Right vertical warning band',
      x: Math.max(0, width - edgeWidth),
      y: 0,
      width: edgeWidth,
      height,
    },
  ];
  const sources = [];
  for (const region of regions) {
    for (const rotation of [90, 270]) {
      const cropWidth = Math.max(1, Math.round(region.width * scale));
      const cropHeight = Math.max(1, Math.round(region.height * scale));
      sources.push({
        id: `${region.id}-rot${rotation}`,
        kind: 'rotated-edge',
        label: `${region.label} rotated ${rotation === 90 ? 'clockwise' : 'counter-clockwise'}`,
        width: cropHeight,
        height: cropWidth,
        scale,
        crop: { x: region.x, y: region.y, width: region.width, height: region.height },
        rotation,
      });
    }
  }
  return sources;
}

export function createOcrVariantPlanForTests(width, height) {
  const scale = sourceScaleFor(width, height);
  return ocrVariantsForSources([
    { id: 'original', kind: 'original', label: 'Original', width, height, scale: 1 },
    { id: 'normalized-gray', kind: 'normalized-gray', label: 'Normalized grayscale', width: Math.round(width * scale), height: Math.round(height * scale), scale },
    { id: 'threshold-inverted', kind: 'threshold-inverted', label: 'Inverted threshold', width: Math.round(width * scale), height: Math.round(height * scale), scale },
    ...rotatedEdgeSourceDescriptors(width, height, scale),
  ]).map(({ id, label, psm, rectangle, source }) => ({
    id,
    label,
    psm,
    rectangle,
    source: {
      id: source.id,
      kind: source.kind,
      scale: source.scale,
      width: source.width,
      height: source.height,
      crop: source.crop,
      rotation: source.rotation,
    },
  }));
}

function shouldTreatBboxAsRelative(lineBbox, rectangle) {
  if (!rectangle) return false;
  return (
    lineBbox.x0 >= 0 &&
    lineBbox.y0 >= 0 &&
    lineBbox.x1 <= rectangle.width + 2 &&
    lineBbox.y1 <= rectangle.height + 2 &&
    (lineBbox.x0 < rectangle.left || lineBbox.y0 < rectangle.top)
  );
}

function mapSourcePointToOriginal(x, y, source) {
  const scale = source.scale || 1;
  const crop = source.crop;
  if (!crop || !source.rotation) {
    return {
      x: (x / scale) + (crop?.x || 0),
      y: (y / scale) + (crop?.y || 0),
    };
  }

  const cropWidth = crop.width * scale;
  const cropHeight = crop.height * scale;
  if (source.rotation === 90) {
    return {
      x: crop.x + (y / scale),
      y: crop.y + ((cropHeight - x) / scale),
    };
  }
  if (source.rotation === 270) {
    return {
      x: crop.x + ((cropWidth - y) / scale),
      y: crop.y + (x / scale),
    };
  }
  if (source.rotation === 180) {
    return {
      x: crop.x + ((cropWidth - x) / scale),
      y: crop.y + ((cropHeight - y) / scale),
    };
  }
  return {
    x: crop.x + (x / scale),
    y: crop.y + (y / scale),
  };
}

function mapBboxToOriginal(lineBbox, variant) {
  if (!lineBbox) return null;
  const source = variant.source || { scale: 1 };
  const rectangle = variant.rectangle;
  const relative = shouldTreatBboxAsRelative(lineBbox, rectangle);
  const offsetX = relative && rectangle ? rectangle.left : 0;
  const offsetY = relative && rectangle ? rectangle.top : 0;
  const x0 = lineBbox.x0 + offsetX;
  const y0 = lineBbox.y0 + offsetY;
  const x1 = lineBbox.x1 + offsetX;
  const y1 = lineBbox.y1 + offsetY;
  const points = [
    mapSourcePointToOriginal(x0, y0, source),
    mapSourcePointToOriginal(x1, y0, source),
    mapSourcePointToOriginal(x1, y1, source),
    mapSourcePointToOriginal(x0, y1, source),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return {
    x: Math.max(0, left),
    y: Math.max(0, top),
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export function mapTesseractBboxForTests(lineBbox, variant) {
  return mapBboxToOriginal(lineBbox, variant);
}

function normalizeLine(line, index, variant) {
  const text = String(line.text || '').trim();
  if (!text) return null;
  const bbox = mapBboxToOriginal(line.bbox, variant);
  return {
    text,
    confidence: Number.isFinite(line.confidence) ? line.confidence / 100 : DEFAULT_CONFIDENCE,
    bbox,
    variantBbox: variant.rectangle
      ? mapBboxToOriginal(
          {
            x0: variant.rectangle.left,
            y0: variant.rectangle.top,
            x1: variant.rectangle.left + variant.rectangle.width,
            y1: variant.rectangle.top + variant.rectangle.height,
          },
          { source: variant.source },
        )
      : null,
    variantId: variant.id,
    index,
  };
}

function lineBlocksFromTesseract(data, variant) {
  const blocks = [];
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const normalized = normalizeLine(line, blocks.length, variant);
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

function canvasFor(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('Canvas image preprocessing is not available in this environment.');
}

async function canvasToBlob(canvas) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not create preprocessed OCR image.'));
    }, 'image/png');
  });
}

function contrastStretch(lumaValues) {
  const sorted = Array.from(lumaValues).sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.02)] ?? 0;
  const high = sorted[Math.floor(sorted.length * 0.98)] ?? 255;
  const range = Math.max(1, high - low);
  return { low, range };
}

async function preprocessImageSource(fileOrBlob, dimensions, mode) {
  if (!('createImageBitmap' in globalThis)) return null;
  const scale = sourceScaleFor(dimensions.width, dimensions.height);
  if (scale <= 1 && mode !== 'threshold-inverted') return null;
  const bitmap = await createImageBitmap(fileOrBlob);
  const width = Math.max(1, Math.round(dimensions.width * scale));
  const height = Math.max(1, Math.round(dimensions.height * scale));
  const canvas = canvasFor(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close?.();
    return null;
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const luma = new Uint8Array(width * height);
  for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel += 1) {
    luma[pixel] = clamp(Math.round((pixels[index] * 0.299) + (pixels[index + 1] * 0.587) + (pixels[index + 2] * 0.114)), 0, 255);
  }
  const { low, range } = contrastStretch(luma);
  for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel += 1) {
    const stretched = clamp(Math.round(((luma[pixel] - low) / range) * 255), 0, 255);
    const value = mode === 'threshold-inverted' ? (stretched > 140 ? 0 : 255) : stretched;
    pixels[index] = value;
    pixels[index + 1] = value;
    pixels[index + 2] = value;
  }
  context.putImageData(imageData, 0, 0);
  return {
    id: mode,
    kind: mode,
    label: mode === 'threshold-inverted' ? 'Inverted threshold' : 'Normalized grayscale',
    blob: await canvasToBlob(canvas),
    width,
    height,
    scale,
  };
}

async function createRotatedEdgeSources(fileOrBlob, dimensions) {
  if (!('createImageBitmap' in globalThis)) return [];
  const bitmap = await createImageBitmap(fileOrBlob);
  const scale = sourceScaleFor(dimensions.width, dimensions.height);
  const sources = [];
  try {
    for (const descriptor of rotatedEdgeSourceDescriptors(dimensions.width, dimensions.height, scale)) {
      const source = await createRotatedCropSource(bitmap, descriptor.crop, descriptor.rotation, scale);
      sources.push({
        ...source,
        ...descriptor,
      });
    }
  } finally {
    bitmap.close?.();
  }
  return sources;
}

async function createRotatedCropSource(bitmap, region, rotation, scale) {
  const cropWidth = Math.max(1, Math.round(region.width * scale));
  const cropHeight = Math.max(1, Math.round(region.height * scale));
  const width = rotation === 90 || rotation === 270 ? cropHeight : cropWidth;
  const height = rotation === 90 || rotation === 270 ? cropWidth : cropHeight;
  const canvas = canvasFor(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas image preprocessing is not available in this environment.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  if (rotation === 90) {
    context.translate(width, 0);
    context.rotate(Math.PI / 2);
  } else if (rotation === 270) {
    context.translate(0, height);
    context.rotate(-Math.PI / 2);
  } else if (rotation === 180) {
    context.translate(width, height);
    context.rotate(Math.PI);
  }
  context.drawImage(bitmap, region.x, region.y, region.width, region.height, 0, 0, cropWidth, cropHeight);
  return {
    blob: await canvasToBlob(canvas),
    width,
    height,
  };
}

async function createOcrSources(fileOrBlob, dimensions, onProgress) {
  const sources = [
    {
      id: 'original',
      kind: 'original',
      label: 'Original',
      blob: fileOrBlob,
      width: dimensions.width,
      height: dimensions.height,
      scale: 1,
    },
  ];
  for (const mode of ['normalized-gray', 'threshold-inverted']) {
    try {
      emitProgress(onProgress, `Preparing ${mode === 'normalized-gray' ? 'grayscale' : 'high-contrast'} OCR view...`, {
        phase: 'preprocess',
        crop: {
          x: 0,
          y: 0,
          width: dimensions.width,
          height: dimensions.height,
          unit: 'pixel',
          source: 'ocr',
        },
      });
      const source = await preprocessImageSource(fileOrBlob, dimensions, mode);
      if (source) sources.push(source);
    } catch (error) {
      emitProgress(onProgress, `Skipping ${mode} preprocessing: ${error?.message || 'not available'}`, { phase: 'preprocess' });
    }
  }
  try {
    emitProgress(onProgress, 'Preparing upright side-warning OCR views...', {
      phase: 'preprocess',
      crop: {
        x: 0,
        y: 0,
        width: dimensions.width,
        height: dimensions.height,
        unit: 'pixel',
        source: 'ocr',
      },
    });
    sources.push(...(await createRotatedEdgeSources(fileOrBlob, dimensions)));
  } catch (error) {
    emitProgress(onProgress, `Skipping rotated side-warning OCR views: ${error?.message || 'not available'}`, { phase: 'preprocess' });
  }
  return sources;
}

async function getWorker(onProgress) {
  currentProgressCallback = onProgress || null;
  if (!workerPromise) {
    const assetConfig = await resolveTesseractAssetConfig();
    workerPromise = createWorker('eng', 1, {
      workerPath: assetConfig.workerPath,
      corePath: assetConfig.corePath,
      langPath: assetConfig.langPath,
      cacheMethod: 'write',
      logger: (message) => {
        if (message.status && Number.isFinite(message.progress)) {
          const percent = Math.round(message.progress * 100);
          const variantPrefix = currentVariantProgress
            ? `${currentVariantProgress.label} (${currentVariantProgress.index}/${currentVariantProgress.total}): `
            : '';
          const meta = currentVariantProgress?.variant
            ? variantProgressMeta(currentVariantProgress.variant, currentVariantProgress.index - 1, currentVariantProgress.total, message.progress)
            : { phase: 'ocr-engine', variantProgress: message.progress, overallProgress: message.progress };
          emitProgress(currentProgressCallback, `${variantPrefix}${message.status} ${percent}%`, meta);
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
  const base = baseUrl().endsWith('/') ? baseUrl() : `${baseUrl()}/`;
  const relativePath = `${base}tesseract/${path}`.replace(/\/{2,}/g, '/');
  if (globalThis.location?.href) return new URL(relativePath, globalThis.location.href).href;
  return relativePath;
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

      if (import.meta.env?.[CDN_FALLBACK_ENV] !== '1') {
        throw new Error(
          `Packaged Tesseract.js assets were not found at ${localWorkerPath}. Run npm run browser:package-tesseract before building, or set ${CDN_FALLBACK_ENV}=1 for a dev-only CDN fallback.`,
        );
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

export async function resolveTesseractAssetConfigForTests() {
  return resolveTesseractAssetConfig();
}

export function resetTesseractAssetConfigForTests() {
  assetConfigPromise = null;
  workerPromise = null;
  currentProgressCallback = null;
}

export async function recognizeImageInBrowser(fileOrBlob, { onProgress } = {}) {
  const startedAt = performance.now();
  emitProgress(onProgress, 'Preparing browser OCR...', { phase: 'queued', overallProgress: 0 });
  const [worker, dimensions, assetConfig] = await Promise.all([
    getWorker(onProgress),
    dimensionsForBlob(fileOrBlob),
    resolveTesseractAssetConfig(),
  ]);
  const sources = await createOcrSources(fileOrBlob, dimensions, onProgress);
  const variants = ocrVariantsForSources(sources);
  const blocks = [];
  const variantResults = [];

  try {
    for (const [variantIndex, variant] of variants.entries()) {
      currentVariantProgress = {
        label: variant.label,
        index: variantIndex + 1,
        total: variants.length,
        variant,
      };
      emitProgress(
        onProgress,
        `Scanning ${variant.label} (${variantIndex + 1}/${variants.length})...`,
        variantProgressMeta(variant, variantIndex, variants.length, 0),
      );
      await worker.setParameters({ tessedit_pageseg_mode: variant.psm });
      const variantStartedAt = performance.now();
      const recognizeOptions = isFullRectangle(variant.rectangle, variant.source) ? {} : { rectangle: variant.rectangle };
      const { data } = await worker.recognize(variant.source.blob, recognizeOptions, { text: true, blocks: true });
      const durationMs = Math.round(performance.now() - variantStartedAt);
      const rawText = data.text || '';
      const variantBlocks = lineBlocksFromTesseract(data, variant);
      blocks.push(...variantBlocks);
      variantResults.push({
        id: variant.id,
        label: variant.label,
        source: variant.source.kind,
        scale: variant.source.scale,
        rawText,
        score: usefulLines(rawText).length,
        textLength: rawText.trim().length,
        lineCount: variantBlocks.length,
        durationMs,
      });
    }
  } finally {
    currentVariantProgress = null;
  }

  const rawText = mergeVariantText(variantResults);
  currentProgressCallback = null;
  return createOcrResult({
    engine: 'tesseract-js-browser',
    rawText,
    blocks,
    processingTimeMs: Math.round(performance.now() - startedAt),
    preprocessingNotes: [
      'Browser-only Tesseract.js OCR',
      'Preset: full-image OCR plus broad overlapping high-contrast views',
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

function isFullRectangle(rectangle, source) {
  return (
    rectangle &&
    rectangle.left === 0 &&
    rectangle.top === 0 &&
    rectangle.width === source.width &&
    rectangle.height === source.height
  );
}
