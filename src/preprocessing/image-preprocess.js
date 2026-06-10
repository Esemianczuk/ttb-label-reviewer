export const MIN_OCR_WIDTH = 1200;
export const MAX_OCR_WIDTH = 2400;

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load image. Try a PNG, JPG/JPEG, or WebP file.'));
    };
    image.src = url;
  });
}

function targetWidthForImage(width) {
  if (width < MIN_OCR_WIDTH) return MIN_OCR_WIDTH;
  if (width > MAX_OCR_WIDTH) return MAX_OCR_WIDTH;
  return width;
}

function enhanceContrast(value, factor = 1.35) {
  return Math.max(0, Math.min(255, (value - 128) * factor + 128));
}

export async function preprocessImageForOcr(fileOrBlob) {
  const image = await loadImageFromBlob(fileOrBlob);
  const targetWidth = targetWidthForImage(image.naturalWidth || image.width);
  const scale = targetWidth / (image.naturalWidth || image.width);
  const width = Math.round((image.naturalWidth || image.width) * scale);
  const height = Math.round((image.naturalHeight || image.height) * scale);
  const notes = [];

  if (scale > 1.01) notes.push('Image upscaled to improve OCR readability');
  if (scale < 0.99) notes.push('Image resized down for faster local OCR');
  notes.push('Grayscale contrast enhancement applied');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const contrasted = enhanceContrast(gray);
    data[index] = contrasted;
    data[index + 1] = contrasted;
    data[index + 2] = contrasted;
  }
  ctx.putImageData(imageData, 0, 0);

  return {
    canvas,
    width,
    height,
    preprocessingNotes: notes,
  };
}
