import { describe, expect, it } from "vitest";
import { cropBoxForImage, estimatedCropForField } from "../../domain/application/evidenceCrops";

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
});
