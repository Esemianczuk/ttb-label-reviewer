import { describe, expect, it, vi } from "vitest";
import { canUseSampleOcrFixture, createBrowserOcrReview, loadLocalOcrFixture } from "../../domain/application/browserOcrReview";
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

  it("does not let progress callbacks delay OCR review completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            images: {
              sheet: {
                engine: "fixture",
                rawText: [
                  "Brand Name: HOLLOW RIDGE",
                  "Class/Type: Kentucky Straight Bourbon Whiskey",
                  "45% Alc./Vol. (90 Proof)",
                  "750 mL",
                  "GOVERNMENT WARNING: According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems."
                ].join("\n"),
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
    const neverResolvingProgress = vi.fn(() => new Promise<void>(() => undefined));

    const review = await Promise.race([
      createBrowserOcrReview({ ...application, images: [sampleImage] }, "browser", { onProgressEvent: neverResolvingProgress }),
      new Promise<never>((_, reject) => globalThis.setTimeout(() => reject(new Error("Review progress callback blocked completion.")), 500))
    ]);

    expect(review.applicationId).toBe(application.id);
    expect(review.fields.length).toBeGreaterThan(0);
    expect(neverResolvingProgress).toHaveBeenCalled();
  });

  it("reports review progress as field completion instead of OCR engine chatter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            images: {
              sheet: {
                engine: "fixture",
                rawText: [
                  "Brand Name: HOLLOW RIDGE",
                  "Class/Type: Kentucky Straight Bourbon Whiskey",
                  "45% Alc./Vol. (90 Proof)",
                  "750 mL",
                  "GOVERNMENT WARNING: According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems."
                ].join("\n"),
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
    const events: Array<{ stage: string; percent: number }> = [];

    const review = await createBrowserOcrReview({ ...application, images: [sampleImage] }, "browser", {
      onProgressEvent: (event) => {
        events.push({ stage: event.stage, percent: event.percent });
      }
    });

    const setupEvents = events.filter((event) => !["field", "complete"].includes(event.stage));
    const fieldEvents = events.filter((event) => event.stage === "field");
    expect(review.fields.length).toBeGreaterThan(0);
    expect(setupEvents.length).toBeGreaterThan(0);
    expect(setupEvents.every((event) => event.percent === 0)).toBe(true);
    expect(fieldEvents.length).toBe(review.fields.length);
    expect(fieldEvents[0]?.percent).toBeGreaterThan(0);
    expect(fieldEvents.at(-1)?.percent).toBe(100);
    expect(events.at(-1)).toEqual({ stage: "complete", percent: 100 });
  });
});
