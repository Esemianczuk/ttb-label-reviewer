import Papa from 'papaparse';
import { cloneExpectedFields } from '../app-state.js';

const IMAGE_MIME_PATTERN = /^image\/(png|jpe?g|webp)$/i;
const CSV_MIME_PATTERN = /^(text\/csv|application\/vnd\.ms-excel)$/i;

export function splitApplicationFiles(files) {
  const images = [];
  const manifests = [];
  for (const file of [...files]) {
    if (IMAGE_MIME_PATTERN.test(file.type)) images.push(file);
    else if (CSV_MIME_PATTERN.test(file.type) || /\.csv$/i.test(file.name)) manifests.push(file);
  }
  return { images, manifests };
}

export async function parseManifestFile(file) {
  const text = await file.text();
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
  });
  if (parsed.errors?.length) {
    throw new Error(parsed.errors[0].message || 'Could not parse the CSV manifest.');
  }
  return parsed.data.filter((row) => Object.values(row).some((value) => String(value || '').trim()));
}

export function createBatchRowsFromImages(images, fallbackExpected) {
  return images.map((image, index) => {
    const labelId = image.name || `Image ${index + 1}`;
    return {
      id: `upload-${index + 1}-${image.id}`,
      title: labelId,
      expected: cloneExpectedFields({ ...fallbackExpected, labelId }),
      images: [image],
      source: 'upload',
      status: 'ready',
      reviewerDecision: '',
      criticalIssues: '',
      processingMode: '',
      workerEngine: '',
      durationMs: null,
      review: null,
      notes: '',
    };
  });
}

export function createBatchRowsFromManifest(rows, images, fallbackExpected) {
  const imageByName = new Map();
  images.forEach((image) => {
    imageByName.set(normalizeFilename(image.name), image);
  });

  return rows.map((row, index) => {
    const filename = firstValue(row, ['image', 'imagefile', 'filename', 'file', 'labelid', 'label']);
    const matchedImage = imageByName.get(normalizeFilename(filename)) || images[index] || null;
    const applicationId = firstValue(row, ['applicationid', 'application', 'ttbid', 'id']) || `manifest-${index + 1}`;
    const labelId = firstValue(row, ['labelid', 'label', 'filename']) || matchedImage?.name || applicationId;
    const title = firstValue(row, ['title', 'name', 'brandname']) || labelId;

    return {
      id: `manifest-${applicationId}-${index + 1}`,
      title,
      expected: cloneExpectedFields({
        ...fallbackExpected,
        brandName: firstValue(row, ['brandname', 'brand']) || fallbackExpected.brandName,
        classType: firstValue(row, ['classtype', 'class', 'type']) || fallbackExpected.classType,
        alcoholContent: firstValue(row, ['alcoholcontent', 'abv', 'alcohol', 'proof']) || fallbackExpected.alcoholContent,
        netContents: firstValue(row, ['netcontents', 'netcontent', 'contents']) || fallbackExpected.netContents,
        governmentWarningRequired: parseBoolean(
          firstValue(row, ['governmentwarningrequired', 'governmentwarning', 'warningrequired']),
          fallbackExpected.governmentWarningRequired,
        ),
        producerName: firstValue(row, ['producername', 'producer', 'bottler', 'importer']) || fallbackExpected.producerName,
        countryOfOrigin: firstValue(row, ['countryoforigin', 'country', 'origin']) || fallbackExpected.countryOfOrigin,
        applicationId,
        labelId,
      }),
      images: matchedImage ? [matchedImage] : [],
      source: 'manifest',
      status: matchedImage ? 'ready' : 'needs_image',
      reviewerDecision: '',
      criticalIssues: matchedImage ? '' : 'Image missing',
      processingMode: '',
      workerEngine: '',
      durationMs: null,
      review: null,
      notes: '',
    };
  });
}

export function summarizeReviewForBatchRow(review, processingMode, durationMs) {
  const criticalIssues = (review?.fields || [])
    .filter((field) => field.severity === 'critical' && !['PASS'].includes(field.agentStatus || field.status))
    .map((field) => field.field)
    .join(', ');
  const workerEngine =
    review?.enginesUsed?.map((engine) => engine.displayName || engine.id || engine.engineId).join(', ') ||
    review?.files?.map((file) => file.ocrResult?.engine).filter(Boolean).join(', ') ||
    'browser';
  return {
    status: review?.overallStatus || 'ready',
    reviewerDecision: review?.overallStatus || '',
    criticalIssues,
    processingMode,
    workerEngine,
    durationMs,
    review,
  };
}

function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeFilename(value = '') {
  return String(value || '').trim().toLowerCase();
}

function firstValue(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  const normalized = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'required'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0', 'not required', 'none'].includes(normalized)) return false;
  return Boolean(fallback);
}
