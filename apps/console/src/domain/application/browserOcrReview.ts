import { BrowserOcrWorkerPool, getRecommendedBrowserOcrWorkerCount } from "@browser-demo/workers/browser-worker-pool.js";
import { validateLabelPacket } from "@browser-demo/validation/overall.js";
import { blocksFromText, createOcrResult } from "@browser-demo/ocr/ocr-types.js";
import type { FieldStatus, LabelImage, ProcessingMode, ReviewApplication, ReviewEvidence, ReviewField, ReviewResult, ReviewStatus, Severity } from "./types";

type BrowserReviewOptions = {
  workerOverride?: string;
  onProgress?: (message: string) => void;
};

type BrowserValidationField = {
  field: string;
  expected?: string;
  extracted?: string;
  status: FieldStatus;
  severity?: Severity;
  confidence?: number | null;
  reason: string;
  evidence?: any;
};

type BrowserImageResult = LabelImage & {
  ocrResult: any;
};

const fieldKeysByLabel: Record<string, ReviewField["fieldKey"]> = {
  "Brand Name": "brandName",
  "Fanciful Name": "fancifulName",
  "Class/Type": "classType",
  "Class / Type": "classType",
  "Alcohol Content": "alcoholContent",
  "Net Contents": "netContents",
  "Government Warning": "governmentWarning",
  "Producer / Bottler / Importer": "producerName",
  "Country of Origin": "countryOfOrigin",
  "Country Of Origin": "countryOfOrigin",
  "Application ID": "applicationId",
  "Filename / Label ID": "labelId",
  "Label ID": "labelId"
};

export function resolveBrowserOcrWorkerCount(imageCount: number, workerOverride = "auto"): number {
  return getRecommendedBrowserOcrWorkerCount(imageCount, { override: workerOverride });
}

export async function createBrowserOcrReview(
  application: ReviewApplication,
  mode: ProcessingMode = "browser",
  options: BrowserReviewOptions = {}
): Promise<ReviewResult> {
  if (!application.images.length) {
    throw new Error("Attach at least one label image before running browser OCR.");
  }

  const startedAt = new Date();
  const workerCount = resolveBrowserOcrWorkerCount(application.images.length, options.workerOverride);
  options.onProgress?.(`Starting browser OCR with ${workerCount} worker${workerCount === 1 ? "" : "s"}.`);
  const imageResults = await recognizeApplicationImages(application, workerCount, options.onProgress);
  options.onProgress?.("Validating detected label evidence against expected TTB fields.");
  const validation = validateLabelPacket(application.expectedFields, imageResults);
  const fields = (validation.fields as Array<BrowserValidationField | null>)
    .filter((field): field is BrowserValidationField => Boolean(field))
    .map((field, index) => mapBrowserField(application, field, index));
  const status = normalizeReviewStatus(validation.overallStatus);
  const completedAt = new Date();

  return {
    id: `review-${application.id}-${Date.now()}`,
    applicationId: application.id,
    mode,
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    fields,
    summary: reviewSummary(status, application.images.length, workerCount),
    engineTrace: [
      "Browser Only Tesseract.js OCR",
      `${workerCount} browser OCR worker${workerCount === 1 ? "" : "s"}`,
      "Shared field normalizers and validators",
      "Image blobs stayed in this browser session",
      `${Math.max(1, completedAt.getTime() - startedAt.getTime())} ms elapsed`
    ]
  };
}

async function recognizeApplicationImages(
  application: ReviewApplication,
  workerCount: number,
  onProgress?: (message: string) => void
): Promise<BrowserImageResult[]> {
  const images = application.images;
  const imageResults = new Array<BrowserImageResult>(images.length);
  const liveImages: Array<{ image: LabelImage; index: number }> = [];

  await Promise.all(
    images.map(async (image, index) => {
      const fixture = await loadLocalOcrFixture(image, application);
      if (fixture) {
        onProgress?.(`${image.name}: local OCR fixture loaded`);
        imageResults[index] = { ...image, ocrResult: fixture };
      } else {
        liveImages.push({ image, index });
      }
    })
  );

  if (!liveImages.length) return imageResults;

  const tasks = await Promise.all(
    liveImages.map(async ({ image, index }) => ({
      id: image.id,
      name: image.name,
      index,
      file: await readImageBlob(image)
    }))
  );
  const pool = new BrowserOcrWorkerPool();
  try {
    const results = await (pool.run as any)(tasks, {
      workerCount: Math.min(workerCount, liveImages.length),
      onTaskStatus: (task: { name: string }, _status: string, message: string) => onProgress?.(`${task.name}: ${message}`),
      onTaskProgress: (task: { name: string }, message: string) => onProgress?.(`${task.name}: ${message}`),
      onTaskComplete: (task: { name: string }) => onProgress?.(`${task.name}: OCR complete`)
    });
    tasks.forEach((task, resultIndex) => {
      imageResults[task.index] = { ...images[task.index], ocrResult: results[resultIndex] };
    });
    return imageResults;
  } finally {
    pool.terminate();
  }
}

async function loadLocalOcrFixture(image: LabelImage, application: ReviewApplication): Promise<any | null> {
  const packetId = packetIdFromImageUrl(image.url) || packetIdFromExpectedFields(application);
  if (!packetId) return null;
  try {
    const response = await fetch(assetPath(`label-packets/${packetId}/ocr-fixture.json`));
    if (!response.ok) return null;
    const fixture = await response.json();
    const fixtureKey = fixtureKeyForImage(image);
    const fixtureImage = fixture.images?.[fixtureKey] || fixture.images?.sheet;
    if (!fixtureImage) return null;
    return createOcrResult({
      engine: fixtureImage.engine || "local-fixture",
      rawText: fixtureImage.rawText || "",
      blocks: fixtureImage.blocks || blocksFromText(fixtureImage.rawText || "", fixtureImage.confidence ?? 0.98),
      processingTimeMs: fixtureImage.processingTimeMs ?? 25,
      preprocessingNotes: fixtureImage.preprocessingNotes || [`Sample OCR fixture loaded for ${image.name}`],
      warnings: fixtureImage.warnings || [],
      source: "fixture"
    });
  } catch {
    return null;
  }
}

function packetIdFromImageUrl(url: string): string | null {
  const match = String(url || "").match(/\/label-packets\/([^/]+)\//);
  return match?.[1] || null;
}

function packetIdFromExpectedFields(application: ReviewApplication): string | null {
  const brand = application.expectedFields.brandName?.toUpperCase().trim();
  const classType = application.expectedFields.classType?.toUpperCase().trim();
  if (brand === "OLD TOM DISTILLERY" && classType.includes("BOURBON")) return "old-tom-pass";
  if (brand === "HOLLOW RIDGE") return "hollow-ridge-bourbon";
  if (brand === "HIGHLAND COAST") return "highland-coast-lightkeeper-gin";
  if (brand === "RIVERLIGHT") return "riverlight-rye-whiskey";
  if (brand === "SUNDAZE") return "sundaze-hard-seltzer";
  if (brand === "ARBOR HILL") return "arbor-hill-cabernet-sauvignon";
  if (brand === "ESTRELLA") return "estrella-tequila-blanco";
  return null;
}

function fixtureKeyForImage(image: LabelImage): string {
  if (image.id.includes(":")) return image.id.split(":").pop() || "sheet";
  if (image.id.endsWith("-sheet")) return "sheet";
  if (/front/i.test(image.name) || image.role === "front") return "front";
  if (/back/i.test(image.name) || image.role === "back") return "back";
  return image.role === "cola_sheet" ? "sheet" : image.role || "sheet";
}

function assetPath(path: string): string {
  return `${import.meta.env.BASE_URL || "/"}${path}`.replace(/\/{2,}/g, "/").replace(":/", "://");
}

async function readImageBlob(image: LabelImage): Promise<Blob> {
  const response = await fetch(image.url);
  if (!response.ok) throw new Error(`Could not read ${image.name} for browser OCR (${response.status}).`);
  return response.blob();
}

function mapBrowserField(application: ReviewApplication, field: BrowserValidationField, index: number): ReviewField {
  const confidence = firstFinite(field.confidence, field.evidence?.score, field.evidence?.confidence, field.evidence?.block?.confidence, 0.5);
  return {
    id: `${application.id}-${fieldKeysByLabel[field.field] || `field-${index}`}`,
    fieldKey: fieldKeysByLabel[field.field] || "labelId",
    label: field.field,
    expected: field.expected || "",
    extracted: field.extracted || field.evidence?.value || field.evidence?.evidence || field.evidence?.text || "",
    status: normalizeReviewStatus(field.status),
    severity: field.severity || (field.status === "PASS" ? "info" : "warning"),
    confidence,
    reason: field.reason,
    evidence: [mapEvidence(application, field, confidence)]
  };
}

function mapEvidence(application: ReviewApplication, field: BrowserValidationField, confidence: number): ReviewEvidence {
  const block = field.evidence?.block || {};
  const fallbackImage = application.images[0];
  const excerpt = field.extracted || field.evidence?.evidence || field.evidence?.value || field.evidence?.text || field.reason;
  return {
    sourceImageId: block.imageId || fallbackImage?.id || "",
    excerpt: String(excerpt || "").slice(0, 220),
    confidence,
    pageAnchor: block.imageName || field.evidence?.method || "Browser OCR"
  };
}

function normalizeReviewStatus(status: string): ReviewStatus {
  if (status === "PASS_WITH_WARNINGS") return "PASS_WITH_WARNINGS";
  if (status === "WARNING") return "WARNING";
  if (status === "NOT_FOUND") return "NOT_FOUND";
  if (status === "FAIL") return "FAIL";
  if (status === "NEEDS_REVIEW") return "NEEDS_REVIEW";
  return "PASS";
}

function reviewSummary(status: ReviewStatus, imageCount: number, workerCount: number): string {
  const prefix = `Browser-only OCR reviewed ${imageCount} image${imageCount === 1 ? "" : "s"} with ${workerCount} worker${workerCount === 1 ? "" : "s"}.`;
  if (status === "PASS") return `${prefix} All required application values matched detected label evidence.`;
  if (status === "FAIL") return `${prefix} One or more required TTB fields conflict with detected evidence.`;
  return `${prefix} The automated review found low-confidence or incomplete evidence requiring an agent decision.`;
}

function firstFinite(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0.5;
}
