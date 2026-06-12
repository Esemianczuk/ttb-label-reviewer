import { describe, expect, it, vi } from "vitest";
import { canUseSampleOcrFixture, loadLocalOcrFixture } from "../../domain/application/browserOcrReview";
import type { LabelImage, ReviewApplication } from "../../domain/application/types";

const application: ReviewApplication = {
  id: "app-upload-hollow-ridge",
  title: "Uploaded Hollow Ridge packet",
  source: "upload",
  status: "DRAFT",
  expectedOutcome: "NEEDS_REVIEW",
  expectedFields: {
    productType: "distilled_spirits",
    brandName: "HOLLOW RIDGE",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContent: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
    governmentWarningRequired: true
  },
  images: [],
  submitter: "Applicant",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  metadata: {}
};

describe("browser OCR fixture gating", () => {
  it("does not load bundled sample OCR for uploaded images that happen to match sample fields", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const uploadImage: LabelImage = {
      id: "upload-hollow-ridge",
      role: "front",
      name: "hollow-ridge-upload.png",
      url: "blob:http://localhost/hollow-ridge",
      mimeType: "image/png",
      source: "upload"
    };

    expect(canUseSampleOcrFixture(uploadImage)).toBe(false);
    await expect(loadLocalOcrFixture(uploadImage, application)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows bundled sample packet images to use deterministic fixture OCR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            images: {
              sheet: {
                engine: "fixture",
                rawText: "Brand Name: HOLLOW RIDGE",
                confidence: 0.99
              }
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    const sampleImage: LabelImage = {
      id: "sample:hollow-ridge-bourbon:sheet",
      role: "cola_sheet",
      name: "hollow-ridge-bourbon-cola-sheet.png",
      url: "/label-packets/hollow-ridge-bourbon/hollow-ridge-bourbon-cola-sheet.png",
      mimeType: "image/png",
      source: "sample"
    };

    expect(canUseSampleOcrFixture(sampleImage)).toBe(true);
    const fixture = await loadLocalOcrFixture(sampleImage, application);
    expect(fixture).toMatchObject({ engine: "fixture", source: "fixture" });
  });
});
