import { SAMPLE_EXPECTED_FIELDS } from '../app-state.js';
import { blocksFromText, createOcrResult } from '../ocr/ocr-types.js';

export const SAMPLE_HASHES = {
  e4bf56d99680d74cf69525c946b6b5fdef275f2d0bfd73224517481ba92081c2: 'old-tom-front',
  '6db54d2fc51e26e35eabc1add4a7f0af3632089507f3d150e7387bc9903526b5': 'old-tom-back',
};

export const SAMPLE_IMAGES = [
  {
    id: 'old-tom-front',
    name: 'old-tom-front.png',
    url: `${import.meta.env.BASE_URL}sample-labels/old-tom-front.png`,
    type: 'image/png',
    size: 136396,
    hash: 'e4bf56d99680d74cf69525c946b6b5fdef275f2d0bfd73224517481ba92081c2',
  },
  {
    id: 'old-tom-back',
    name: 'old-tom-back.png',
    url: `${import.meta.env.BASE_URL}sample-labels/old-tom-back.png`,
    type: 'image/png',
    size: 161873,
    hash: '6db54d2fc51e26e35eabc1add4a7f0af3632089507f3d150e7387bc9903526b5',
  },
];

const FRONT_TEXT = `OLD TOM DISTILLERY
KENTUCKY STRAIGHT BOURBON WHISKEY
45% ALC./VOL. (90 PROOF)
750 mL
DISTILLED AND BOTTLED BY OLD TOM DISTILLERY
LEXINGTON, KENTUCKY
PRODUCT OF UNITED STATES`;

const BACK_TEXT = `OLD TOM DISTILLERY
KENTUCKY STRAIGHT BOURBON WHISKEY
GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON GENERAL, WOMEN SHOULD NOT DRINK ALCOHOLIC BEVERAGES DURING PREGNANCY BECAUSE OF THE RISK OF BIRTH DEFECTS. (2) CONSUMPTION OF ALCOHOLIC BEVERAGES IMPAIRS YOUR ABILITY TO DRIVE A CAR OR OPERATE MACHINERY, AND MAY CAUSE HEALTH PROBLEMS.
OLD TOM DISTILLERY
LEXINGTON, KENTUCKY
PRODUCT OF UNITED STATES`;

export const SAMPLE_OCR_FIXTURES = {
  'old-tom-front': createOcrResult({
    engine: 'local-fixture',
    rawText: FRONT_TEXT,
    blocks: blocksFromText(FRONT_TEXT),
    processingTimeMs: 25,
    preprocessingNotes: ['Bundled sample image matched by local SHA-256 fixture'],
    source: 'fixture',
  }),
  'old-tom-back': createOcrResult({
    engine: 'local-fixture',
    rawText: BACK_TEXT,
    blocks: blocksFromText(BACK_TEXT),
    processingTimeMs: 25,
    preprocessingNotes: ['Bundled sample image matched by local SHA-256 fixture'],
    source: 'fixture',
  }),
};

export function createSampleImageEntries() {
  return SAMPLE_IMAGES.map((image) => ({
    id: image.id,
    name: image.name,
    type: image.type,
    size: image.size || 0,
    url: image.url,
    hash: image.hash,
    fixtureKey: image.id,
    source: 'sample',
  }));
}

export function sampleExpectedFields() {
  return { ...SAMPLE_EXPECTED_FIELDS };
}

export async function sha256ForBlob(blob) {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function fixtureForImageEntry(entry) {
  if (entry.fixtureKey && SAMPLE_OCR_FIXTURES[entry.fixtureKey]) {
    return SAMPLE_OCR_FIXTURES[entry.fixtureKey];
  }
  if (!entry.file) return null;
  const hash = await sha256ForBlob(entry.file);
  entry.hash = hash;
  const key = SAMPLE_HASHES[hash];
  return key ? SAMPLE_OCR_FIXTURES[key] : null;
}
