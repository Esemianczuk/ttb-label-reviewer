import { describe, expect, it } from "vitest";
import { trustedProcessingCrop } from "../../components/common/ImageWorkbench";
import { mergeLiveReviewField } from "../../components/review/ReviewWorkbench";
import { cropBoxForImage, estimatedCropForField } from "../../domain/application/evidenceCrops";
import type { EvidenceCrop, ReviewField } from "../../domain/application/types";

describe("evidence crop estimates", () => {
  it("keeps the Arbor Hill label brand area inside the estimated brand crop", () => {
    const crop = estimatedCropForField("brandName");
    const box = cropBoxForImage(crop, 1536, 1024);

    expect(box.x).toBeLessThanOrEqual(610);
    expect(box.y).toBeLessThanOrEqual(220);
    expect(box.x + box.width).toBeGreaterThanOrEqual(900);
    expect(box.y + box.height).toBeGreaterThanOrEqual(430);
  });

  it("pads estimated crops enough to show useful surrounding context", () => {
    const crop = estimatedCropForField("alcoholContent");
    const rawWidth = crop.width * 1536;
    const rawHeight = crop.height * 1024;
    const box = cropBoxForImage(crop, 1536, 1024);

    expect(box.width).toBeGreaterThan(rawWidth);
    expect(box.height).toBeGreaterThan(rawHeight);
  });

  it("uses candidate and OCR crops for processing overlays", () => {
    const estimated: EvidenceCrop = { x: 0.2, y: 0.2, width: 0.3, height: 0.2, unit: "ratio", source: "estimated" };
    const ocr: EvidenceCrop = { x: 120, y: 90, width: 240, height: 70, unit: "pixel", source: "ocr" };

    expect(trustedProcessingCrop({ active: true, stage: "field", message: "", percent: 50, mode: "backend", crop: estimated })).toEqual(estimated);
    expect(trustedProcessingCrop({ active: true, stage: "field", message: "", percent: 50, mode: "backend", crop: ocr })).toEqual(ocr);
    expect(trustedProcessingCrop({ active: true, stage: "field", message: "", percent: 50, mode: "browser", crop: estimated })).toEqual(estimated);
  });

  it("replaces live candidate rows with final OCR rows by field key", () => {
    const candidate = reviewField({
      id: "preview-brand",
      fieldKey: "brandName",
      extracted: "Preview brand",
      evidenceCrop: { x: 0.12, y: 0.2, width: 0.3, height: 0.2, unit: "ratio", source: "estimated" }
    });
    const final = reviewField({
      id: "backend-brand",
      fieldKey: "brandName",
      extracted: "Final brand",
      evidenceCrop: { x: 22, y: 34, width: 240, height: 72, unit: "pixel", source: "ocr" }
    });

    expect(mergeLiveReviewField([candidate], final)).toEqual([final]);
  });
});

function reviewField({
  id,
  fieldKey,
  extracted,
  evidenceCrop
}: {
  id: string;
  fieldKey: ReviewField["fieldKey"];
  extracted: string;
  evidenceCrop: EvidenceCrop;
}): ReviewField {
  return {
    id,
    fieldKey,
    label: "Brand Name",
    expected: "Expected brand",
    extracted,
    status: "PASS",
    severity: "info",
    confidence: 0.98,
    reason: "Evidence matched.",
    evidence: [{ sourceImageId: "image-1", excerpt: extracted, confidence: 0.98, crop: evidenceCrop }]
  };
}
