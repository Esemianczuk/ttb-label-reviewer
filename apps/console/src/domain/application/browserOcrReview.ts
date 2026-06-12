import { BrowserOcrWorkerPool, getRecommendedBrowserOcrWorkerCount } from "@browser-demo/workers/browser-worker-pool.js";
import { validateLabelPacket } from "@browser-demo/validation/overall.js";
import { blocksFromText, createOcrResult } from "@browser-demo/ocr/ocr-types.js";
import type { EvidenceCrop, FieldStatus, LabelImage, ProcessingMode, ReviewApplication, ReviewEvidence, ReviewField, ReviewResult, ReviewStatus, Severity } from "./types";
import { cropFromOcrBlock, estimatedCropForField } from "./evidenceCrops";

export type BrowserReviewProgressEvent = {
  stage: "queued" | "segmenting" | "ocr" | "validating" | "field" | "complete";
  message: string;
  percent: number;
  imageId?: string;
  imageName?: string;
  field?: ReviewField;
  fieldLabel?: string;
  confidence?: number;
  crop?: EvidenceCrop;
  workerLabel?: string;
};

type BrowserReviewOptions = {
  workerOverride?: string;
  onProgress?: (message: string) => void;
  onProgressEvent?: (event: BrowserReviewProgressEvent) => void | Promise<void>;
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
  ocrSource: "sample-fixture" | "browser-ocr";
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
  await emitReviewProgress(options, {
    stage: "queued",
    message: `Queued ${application.images.length} image${application.images.length === 1 ? "" : "s"} for local OCR.`,
    percent: 8,
    imageId: application.images[0]?.id,
    imageName: application.images[0]?.name,
    workerLabel: `${workerCount} browser worker${workerCount === 1 ? "" : "s"}`
  });
  await emitReviewProgress(options, {
    stage: "segmenting",
    message: "Segmenting label regions and preparing OCR views.",
    percent: 18,
    imageId: application.images[0]?.id,
    imageName: application.images[0]?.name,
    workerLabel: `${workerCount} browser worker${workerCount === 1 ? "" : "s"}`
  });
  await pauseForReviewAnimation(90);
  options.onProgress?.("Reading label text with local OCR.");
  const imageResults = await recognizeApplicationImages(application, workerCount, options.onProgress);
  const fixtureCount = imageResults.filter((image) => image.ocrSource === "sample-fixture").length;
  const liveCount = imageResults.length - fixtureCount;
  await emitReviewProgress(options, {
    stage: "ocr",
    message: liveCount ? "OCR text captured from browser workers." : "Bundled OCR fixture loaded for this public COLA sample.",
    percent: 38,
    imageId: imageResults[0]?.id,
    imageName: imageResults[0]?.name,
    workerLabel: liveCount ? `${workerCount} browser worker${workerCount === 1 ? "" : "s"}` : "Fixture OCR cache"
  });
  await pauseForReviewAnimation(liveCount ? 70 : 120);
  options.onProgress?.("Validating detected label evidence against expected TTB fields.");
  await emitReviewProgress(options, {
    stage: "validating",
    message: "Classifying extracted evidence against required TTB fields.",
    percent: 48,
    imageId: imageResults[0]?.id,
    imageName: imageResults[0]?.name,
    workerLabel: "Deterministic validators"
  });
  const validation = validateLabelPacket(application.expectedFields, imageResults);
  const validationFields = (validation.fields as Array<BrowserValidationField | null>).filter((field): field is BrowserValidationField => Boolean(field));
  const fields: ReviewField[] = [];
  for (const [index, field] of validationFields.entries()) {
    const mapped = mapBrowserField(application, field, index);
    fields.push(mapped);
    await emitReviewProgress(options, {
      stage: "field",
      message: `${mapped.label}: ${statusLabel(mapped.status)} at ${Math.round(mapped.confidence * 100)}% confidence.`,
      percent: Math.min(94, 54 + Math.round(((index + 1) / Math.max(validationFields.length, 1)) * 36)),
      imageId: mapped.evidence[0]?.sourceImageId,
      imageName: application.images.find((image) => image.id === mapped.evidence[0]?.sourceImageId)?.name,
      field: mapped,
      fieldLabel: mapped.label,
      confidence: mapped.confidence,
      crop: mapped.evidence[0]?.crop,
      workerLabel: mapped.evidence[0]?.pageAnchor || "Evidence scorer"
    });
    await pauseForReviewAnimation(liveCount ? 30 : 75);
  }
  const status = normalizeReviewStatus(validation.overallStatus);
  const completedAt = new Date();
  await emitReviewProgress(options, {
    stage: "complete",
    message: "Evidence review complete.",
    percent: 100,
    imageId: imageResults[0]?.id,
    imageName: imageResults[0]?.name,
    workerLabel: "Review package ready"
  });

  return {
    id: `review-${application.id}-${Date.now()}`,
    applicationId: application.id,
    mode,
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    fields,
    summary: reviewSummary(status, application.images.length, workerCount),
    rawOcrText: formatRawOcrText(imageResults),
    engineTrace: [
      fixtureCount ? `Sample fixture OCR: ${fixtureCount} bundled sample image${fixtureCount === 1 ? "" : "s"}` : "",
      liveCount ? `Browser OCR: ${liveCount} image${liveCount === 1 ? "" : "s"} processed locally with Tesseract.js` : "",
      `${workerCount} browser OCR worker${workerCount === 1 ? "" : "s"}`,
      "Shared field normalizers and validators",
      "Image blobs stayed in this browser session",
      `${Math.max(1, completedAt.getTime() - startedAt.getTime())} ms elapsed`
    ].filter(Boolean)
  };
}

async function emitReviewProgress(options: BrowserReviewOptions, event: BrowserReviewProgressEvent): Promise<void> {
  options.onProgress?.(event.message);
  await options.onProgressEvent?.(event);
}

async function pauseForReviewAnimation(ms: number): Promise<void> {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  await new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function statusLabel(status: FieldStatus): string {
  if (status === "PASS" || status === "PASS_WITH_WARNINGS") return "pass";
  if (status === "FAIL" || status === "NOT_FOUND") return "fail";
  return "review";
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
        onProgress?.(`${image.name}: Sample fixture OCR loaded`);
        imageResults[index] = { ...image, ocrResult: fixture, ocrSource: "sample-fixture" };
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
      imageResults[task.index] = { ...images[task.index], ocrResult: results[resultIndex], ocrSource: "browser-ocr" };
    });
    return imageResults;
  } finally {
    pool.terminate();
  }
}

export async function loadLocalOcrFixture(image: LabelImage, _application: ReviewApplication): Promise<any | null> {
  if (!canUseSampleOcrFixture(image)) return null;
  const packetId = packetIdFromImageUrl(image.url);
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
      preprocessingNotes: fixtureImage.preprocessingNotes || [`Sample fixture OCR loaded for ${image.name}`],
      warnings: fixtureImage.warnings || [],
      source: "fixture"
    });
  } catch {
    return null;
  }
}

export function canUseSampleOcrFixture(image: LabelImage): boolean {
  return image.source === "sample" && /\/label-packets\/[^/]+\//.test(String(image.url || ""));
}

function packetIdFromImageUrl(url: string): string | null {
  const match = String(url || "").match(/\/label-packets\/([^/]+)\//);
  return match?.[1] || null;
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
    pageAnchor: block.imageName || field.evidence?.method || "Browser OCR",
    crop: cropFromOcrBlock(block) || estimatedCropForField(fieldKeysByLabel[field.field] || "labelId")
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

function reviewSummary(status: ReviewStatus, imageCount: number, _workerCount: number): string {
  const prefix = `Evidence review checked ${imageCount} label image${imageCount === 1 ? "" : "s"} with local OCR.`;
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

function formatRawOcrText(imageResults: BrowserImageResult[]): string {
  return imageResults
    .map((image) => {
      const rawText = String(image.ocrResult?.rawText || textFromBlocks(image.ocrResult?.blocks) || "").trim();
      if (!rawText) return "";
      return [`Image: ${image.name}`, `Role: ${image.role.replace("_", " ")}`, "", rawText].join("\n");
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function textFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((block: any) => block?.text || block?.value || "")
    .filter(Boolean)
    .join("\n");
}
