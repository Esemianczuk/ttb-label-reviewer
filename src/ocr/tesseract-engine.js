import { createWorker, PSM } from 'tesseract.js';
import { flattenOcrBlocks } from '../extraction/candidate-search.js';
import { preprocessImageForOcr } from '../preprocessing/image-preprocess.js';
import { createOcrResult } from './ocr-types.js';

let workerPromise = null;

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

async function getWorker(onProgress) {
  if (window.location.protocol === 'file:') {
    throw new Error('Browser OCR workers need the app to be served over http://localhost. Use npm run dev or npm run preview for OCR. The bundled sample fixture still works locally.');
  }

  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      workerPath: assetPath('tesseract/worker.min.js'),
      corePath: assetPath('tesseract-core'),
      langPath: assetPath('tessdata'),
      gzip: true,
      logger: (message) => onProgress?.(describeProgress(message)),
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: '1',
      });
      return worker;
    });
  }
  return workerPromise;
}

export async function recognizeImage(fileOrBlob, { onProgress } = {}) {
  const startedAt = performance.now();
  onProgress?.('Preparing image...');
  const preprocessed = await preprocessImageForOcr(fileOrBlob);
  const worker = await getWorker(onProgress);
  onProgress?.('Reading text...');
  const response = await worker.recognize(preprocessed.canvas, {}, { text: true, blocks: true });
  const rawText = response?.data?.text || '';
  const blocks = flattenOcrBlocks({
    blocks: response?.data?.blocks || [],
    rawText,
  });

  return createOcrResult({
    engine: 'tesseract-js',
    rawText,
    blocks,
    processingTimeMs: Math.round(performance.now() - startedAt),
    preprocessingNotes: preprocessed.preprocessingNotes,
    warnings: rawText.trim() ? [] : ['OCR returned no text for this image.'],
    source: 'ocr',
  });
}

export async function terminateOcrWorker() {
  if (!workerPromise) return;
  const worker = await workerPromise;
  await worker.terminate();
  workerPromise = null;
}
