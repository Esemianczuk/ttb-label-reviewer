import type { EvidenceCrop, ReviewField } from "./types";

type OcrBlock = {
  bbox?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  } | null;
};

export function cropFromOcrBlock(block: OcrBlock | undefined): EvidenceCrop | undefined {
  const box = block?.bbox;
  if (!box) return undefined;
  const { x, y, width, height } = box;
  if (![x, y, width, height].every((value) => Number.isFinite(value)) || !width || !height) return undefined;
  return {
    x: Number(x),
    y: Number(y),
    width: Number(width),
    height: Number(height),
    unit: "pixel",
    source: "ocr"
  };
}

export function estimatedCropForField(fieldKey: ReviewField["fieldKey"]): EvidenceCrop {
  const crop = estimatedCropByField[fieldKey] || estimatedCropByField.default;
  return { ...crop, unit: "ratio", source: "estimated" };
}

export function cropBoxForImage(crop: EvidenceCrop, imageWidth: number, imageHeight: number) {
  const pixelCrop =
    crop.unit === "ratio"
      ? {
          x: crop.x * imageWidth,
          y: crop.y * imageHeight,
          width: crop.width * imageWidth,
          height: crop.height * imageHeight
        }
      : crop;
  const paddingX = crop.source === "ocr" ? Math.max(18, pixelCrop.width * 0.55) : Math.max(14, pixelCrop.width * 0.16);
  const paddingY = crop.source === "ocr" ? Math.max(12, pixelCrop.height * 0.9) : Math.max(10, pixelCrop.height * 0.18);
  const left = clampCrop(Math.floor(pixelCrop.x - paddingX), 0, imageWidth - 1);
  const top = clampCrop(Math.floor(pixelCrop.y - paddingY), 0, imageHeight - 1);
  const right = clampCrop(Math.ceil(pixelCrop.x + pixelCrop.width + paddingX), left + 1, imageWidth);
  const bottom = clampCrop(Math.ceil(pixelCrop.y + pixelCrop.height + paddingY), top + 1, imageHeight);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

const estimatedCropByField: Record<string, Omit<EvidenceCrop, "unit" | "source">> = {
  brandName: { x: 0.39, y: 0.2, width: 0.24, height: 0.28 },
  fancifulName: { x: 0.4, y: 0.35, width: 0.25, height: 0.17 },
  classType: { x: 0.4, y: 0.34, width: 0.26, height: 0.18 },
  alcoholContent: { x: 0.43, y: 0.56, width: 0.22, height: 0.13 },
  netContents: { x: 0.56, y: 0.56, width: 0.14, height: 0.13 },
  governmentWarning: { x: 0.59, y: 0.43, width: 0.2, height: 0.18 },
  producerName: { x: 0.59, y: 0.35, width: 0.19, height: 0.16 },
  countryOfOrigin: { x: 0.59, y: 0.35, width: 0.19, height: 0.16 },
  applicationId: { x: 0.84, y: 0.03, width: 0.12, height: 0.08 },
  labelId: { x: 0.01, y: 0.77, width: 0.38, height: 0.16 },
  default: { x: 0.39, y: 0.2, width: 0.58, height: 0.46 }
};

function clampCrop(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
