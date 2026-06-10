export const MIN_OCR_WIDTH = 1600;
export const MAX_OCR_WIDTH = 3600;

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function targetWidthForCrop(width, preferredWidth) {
  const target = preferredWidth || (width < MIN_OCR_WIDTH ? MIN_OCR_WIDTH : width);
  return clamp(target, MIN_OCR_WIDTH, MAX_OCR_WIDTH);
}

function cropFromFractions(image, { x = 0, y = 0, width = 1, height = 1 }) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const left = Math.round(clamp(x, 0, 0.98) * sourceWidth);
  const top = Math.round(clamp(y, 0, 0.98) * sourceHeight);
  const cropWidth = Math.round(clamp(width, 0.02, 1) * sourceWidth);
  const cropHeight = Math.round(clamp(height, 0.02, 1) * sourceHeight);
  return {
    left,
    top,
    width: Math.min(cropWidth, sourceWidth - left),
    height: Math.min(cropHeight, sourceHeight - top),
  };
}

function percentileFromHistogram(histogram, total, percentile) {
  const threshold = total * percentile;
  let running = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    running += histogram[index];
    if (running >= threshold) return index;
  }
  return histogram.length - 1;
}

function otsuThreshold(histogram, total) {
  let sum = 0;
  for (let index = 0; index < 256; index += 1) sum += index * histogram[index];

  let sumB = 0;
  let wB = 0;
  let maxVariance = 0;
  let threshold = 128;

  for (let index = 0; index < 256; index += 1) {
    wB += histogram[index];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += index * histogram[index];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) ** 2;
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = index;
    }
  }

  return threshold;
}

function applySharpen(imageData, amount = 0.45) {
  if (!amount) return;

  const { data, width, height } = imageData;
  const source = new Uint8ClampedArray(data);
  const centerWeight = 1 + (4 * amount);
  const rowStride = width * 4;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      const value =
        source[index] * centerWeight -
        amount * (source[index - 4] + source[index + 4] + source[index - rowStride] + source[index + rowStride]);
      const sharpened = clamp(value, 0, 255);
      data[index] = sharpened;
      data[index + 1] = sharpened;
      data[index + 2] = sharpened;
    }
  }
}

function transformForOcr(canvas, { invert = false, binary = false, contrast = 1.25, sharpen = 0 } = {}) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const grayValues = new Uint8Array(data.length / 4);
  const histogram = new Array(256).fill(0);

  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    const gray = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
    grayValues[pixel] = gray;
    histogram[gray] += 1;
  }

  const low = percentileFromHistogram(histogram, grayValues.length, 0.01);
  const high = percentileFromHistogram(histogram, grayValues.length, 0.99);
  const range = Math.max(1, high - low);
  const threshold = otsuThreshold(histogram, grayValues.length);

  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    let value = clamp(((grayValues[pixel] - low) / range) * 255, 0, 255);
    value = clamp((value - 128) * contrast + 128, 0, 255);
    if (binary) value = grayValues[pixel] > threshold ? 255 : 0;
    if (invert) value = 255 - value;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }

  applySharpen(imageData, sharpen);
  ctx.putImageData(imageData, 0, 0);
}

function makeCanvasVariant(image, definition) {
  const source = cropFromFractions(image, definition.crop);
  const targetWidth = targetWidthForCrop(source.width, definition.targetWidth);
  const scale = targetWidth / source.width;
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, source.left, source.top, source.width, source.height, 0, 0, width, height);
  transformForOcr(canvas, definition.transform);

  return {
    id: definition.id,
    label: definition.label,
    psm: definition.psm,
    canvas,
    width,
    height,
    crop: source,
    preprocessingNotes: [
      `${definition.label} OCR variant`,
      scale > 1.01 ? 'Image region upscaled for OCR' : 'Image region resized for OCR',
      definition.transform?.binary ? 'Binary threshold applied' : 'Grayscale auto-level contrast applied',
      definition.transform?.sharpen ? 'Detail sharpening applied' : '',
      definition.transform?.invert ? 'Inverted contrast for light text on dark label regions' : '',
    ].filter(Boolean),
  };
}

export async function preprocessImageVariantsForOcr(fileOrBlob) {
  const image = await loadImageFromBlob(fileOrBlob);
  const definitions = [
    {
      id: 'full-block',
      label: 'Full image block',
      crop: { x: 0, y: 0, width: 1, height: 1 },
      psm: 'singleBlock',
      targetWidth: 2600,
      transform: { contrast: 1.25 },
    },
    {
      id: 'full-sparse',
      label: 'Full image sparse text',
      crop: { x: 0, y: 0, width: 1, height: 1 },
      psm: 'sparseText',
      targetWidth: 2600,
      transform: { contrast: 1.35 },
    },
    {
      id: 'center-label',
      label: 'Central label crop',
      crop: { x: 0.18, y: 0.03, width: 0.66, height: 0.92 },
      psm: 'singleBlock',
      targetWidth: 2500,
      transform: { contrast: 1.35 },
    },
    {
      id: 'upper-label',
      label: 'Upper label crop',
      crop: { x: 0.18, y: 0.03, width: 0.66, height: 0.48 },
      psm: 'singleBlock',
      targetWidth: 2500,
      transform: { contrast: 1.35 },
    },
    {
      id: 'lower-label',
      label: 'Lower label crop',
      crop: { x: 0.18, y: 0.55, width: 0.68, height: 0.31 },
      psm: 'singleBlock',
      targetWidth: 3600,
      transform: { contrast: 1.5, sharpen: 0.55 },
    },
    {
      id: 'lower-inverted',
      label: 'Lower label inverted crop',
      crop: { x: 0.18, y: 0.55, width: 0.68, height: 0.31 },
      psm: 'singleBlock',
      targetWidth: 3600,
      transform: { contrast: 1.5, invert: true, sharpen: 0.55 },
    },
    {
      id: 'warning-band',
      label: 'Warning/detail band crop',
      crop: { x: 0.16, y: 0.50, width: 0.72, height: 0.32 },
      psm: 'sparseText',
      targetWidth: 3000,
      transform: { contrast: 1.45, sharpen: 0.35 },
    },
  ];

  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    variants: definitions.map((definition) => makeCanvasVariant(image, definition)),
  };
}

export async function preprocessImageForOcr(fileOrBlob) {
  const result = await preprocessImageVariantsForOcr(fileOrBlob);
  return result.variants[0];
}
