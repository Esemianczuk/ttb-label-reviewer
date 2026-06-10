import { normalizeWhitespace, similarityScore, tokenizeForMatch } from '../normalization/text-normalize.js';
import { STATUS } from '../validation/status.js';

const bitmapCache = new Map();
const MIN_SCORE = 0.55;
const MAX_CROPS_PER_FIELD = 2;
const CROP_WIDTH = 260;
const IGNORED_TOKENS = new Set(['AND', 'FOR', 'THE', 'WITH', 'WAS', 'ARE', 'THIS', 'THAT']);

function fieldTargetTexts(field) {
  return [
    field.extracted,
    field.evidence?.evidence,
    field.evidence?.value,
    field.evidence?.text,
    field.expected,
  ]
    .map((value) => normalizeWhitespace(value || ''))
    .filter(Boolean);
}

function meaningfulTokens(text = '') {
  return tokenizeForMatch(text).filter((token) => token.length > 2 && !IGNORED_TOKENS.has(token));
}

function tokenOverlapScore(targetTexts, blockText) {
  const blockTokens = meaningfulTokens(blockText);
  if (!blockTokens.length) return 0;
  let best = 0;
  for (const targetText of targetTexts) {
    const targetTokens = new Set(meaningfulTokens(targetText));
    if (!targetTokens.size) continue;
    const matches = blockTokens.filter((token) => targetTokens.has(token)).length;
    best = Math.max(best, matches / blockTokens.length);
  }
  return best;
}

function directEvidenceBlock(field) {
  const block = field.evidence?.block;
  if (block?.bbox && block.imageUrl) return block;
  return null;
}

function scoreBlock(field, block) {
  if (!block?.bbox || !block.imageUrl) return 0;
  const targetTexts = fieldTargetTexts(field);
  if (!targetTexts.length) return 0;
  const textScore = Math.max(...targetTexts.map((text) => similarityScore(text, block.text || '')));
  const overlapScore = tokenOverlapScore(targetTexts, block.text || '');
  return Math.max(textScore, overlapScore);
}

function allVisualBlocks(review) {
  return (review.combinedOcr?.blocks || []).filter((block) => block?.bbox && block.imageUrl);
}

function selectEvidenceBlocks(field, review) {
  if ([STATUS.NOT_FOUND, STATUS.WARNING].includes(field.status)) return [];
  if (field.evidence?.method === 'required-segment-check' && (!Number.isFinite(field.confidence) || field.confidence < 0.5)) {
    return [];
  }

  const direct = directEvidenceBlock(field);
  if (direct) return [direct];

  const scored = allVisualBlocks(review)
    .map((block) => ({ block, score: scoreBlock(field, block) }))
    .filter((item) => item.score >= MIN_SCORE)
    .sort((left, right) => right.score - left.score);

  const seen = new Set();
  const selected = [];
  for (const item of scored) {
    const key = `${item.block.imageId}:${Math.round(item.block.bbox.x)}:${Math.round(item.block.bbox.y)}:${item.block.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(item.block);
    if (selected.length >= MAX_CROPS_PER_FIELD) break;
  }
  return selected;
}

async function blobForImage(file) {
  if (file.file) return file.file;
  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`Could not load image evidence from ${file.name}.`);
  return response.blob();
}

async function bitmapForFile(file) {
  const key = file.id || file.url || file.name;
  if (!bitmapCache.has(key)) {
    bitmapCache.set(
      key,
      blobForImage(file).then(async (blob) => {
        if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
        return new Promise((resolve, reject) => {
          const url = URL.createObjectURL(blob);
          const image = new Image();
          image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image);
          };
          image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error(`Could not decode image evidence from ${file.name}.`));
          };
          image.src = url;
        });
      }),
    );
  }
  return bitmapCache.get(key);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function expandedCropBox(bbox, imageWidth, imageHeight) {
  const padX = Math.max(18, bbox.width * 0.55);
  const padY = Math.max(12, bbox.height * 0.9);
  const left = clamp(Math.floor(bbox.x - padX), 0, imageWidth - 1);
  const top = clamp(Math.floor(bbox.y - padY), 0, imageHeight - 1);
  const right = clamp(Math.ceil(bbox.x + bbox.width + padX), left + 1, imageWidth);
  const bottom = clamp(Math.ceil(bbox.y + bbox.height + padY), top + 1, imageHeight);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

async function cropForBlock(block, review) {
  const file = review.files.find((candidate) => candidate.id === block.imageId) || review.files[block.imageIndex];
  if (!file) return null;

  const bitmap = await bitmapForFile(file);
  const cropBox = expandedCropBox(block.bbox, bitmap.width, bitmap.height);
  const scale = Math.min(1, CROP_WIDTH / cropBox.width);
  const width = Math.max(1, Math.round(cropBox.width * scale));
  const height = Math.max(1, Math.round(cropBox.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, cropBox.x, cropBox.y, cropBox.width, cropBox.height, 0, 0, width, height);

  return {
    src: canvas.toDataURL('image/jpeg', 0.86),
    text: block.text || '',
    imageName: block.imageName || file.name,
    bbox: cropBox,
    confidence: block.confidence,
  };
}

async function cropsForField(field, review) {
  const blocks = selectEvidenceBlocks(field, review);
  if (!blocks.length) return [];
  const crops = await Promise.all(blocks.map((block) => cropForBlock(block, review)));
  return crops.filter(Boolean);
}

export async function attachEvidenceCrops(review) {
  const fields = await Promise.all(
    review.fields.map(async (field) => ({
      ...field,
      evidenceCrops: await cropsForField(field, review),
    })),
  );
  return { ...review, fields };
}
