import { recognizeImageInBrowser } from '../ocr/browser-tesseract.js';

self.addEventListener('message', async (event) => {
  const { type, taskId, file } = event.data || {};
  if (type !== 'recognize' || !taskId) return;

  try {
    const ocrResult = await recognizeImageInBrowser(file, {
      onProgress: (message, meta) => {
        self.postMessage({ type: 'progress', taskId, message, meta });
      },
    });
    self.postMessage({ type: 'result', taskId, ocrResult });
  } catch (error) {
    self.postMessage({
      type: 'error',
      taskId,
      error: error?.message || 'Browser OCR worker failed.',
    });
  }
});
