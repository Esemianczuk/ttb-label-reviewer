import { describe, expect, it } from "vitest";
import type { ExpectedFields, LabelImage } from "../../domain/application/types";
import { canAccess } from "../../providers/access/permissionMatrix";
import {
  createApplicantDraft,
  getSnapshot,
  requestApplicantCorrection,
  resetSnapshot,
  respondToApplicantCorrection,
  runApplicantPrecheck,
  submitApplicantApplication
} from "../../providers/data/browserStore";

const expectedFields: ExpectedFields = {
  productType: "distilled_spirits",
  brandName: "PHASE NINE",
  classType: "Distilled Spirits Specialty",
  alcoholContent: "40% Alc./Vol.",
  netContents: "750 mL",
  governmentWarningRequired: true,
  producerName: "Phase Nine Spirits",
  countryOfOrigin: "United States",
  applicationId: "PHASE-9"
};

const images: LabelImage[] = [
  {
    id: "front",
    role: "front",
    name: "front.png",
    url: "/front.png",
    mimeType: "image/png",
    source: "upload"
  },
  {
    id: "back",
    role: "back",
    name: "back.png",
    url: "/back.png",
    mimeType: "image/png",
    source: "upload"
  }
];

describe("phase 9 applicant workflow", () => {
  it("creates a multi-image draft, prechecks it, and submits it", () => {
    resetSnapshot();
    const draftSnapshot = createApplicantDraft({ expectedFields, images, submitter: "Applicant" });
    const applicationId = draftSnapshot.activeApplicationId;
    expect(draftSnapshot.applications[0].images).toHaveLength(2);
    expect(draftSnapshot.applications[0].status).toBe("DRAFT");

    const prechecked = runApplicantPrecheck(applicationId, "browser");
    expect(prechecked.applications[0].status).toBe("READY_TO_SUBMIT");
    expect(prechecked.applications[0].review?.fields.length).toBeGreaterThan(4);

    const submitted = submitApplicantApplication(applicationId);
    expect(submitted.applications[0].status).toBe("SUBMITTED");
  });

  it("preserves correction request and response history during resubmission", () => {
    resetSnapshot();
    const applicationId = getSnapshot().applications.find((application) => application.status === "NEEDS_CORRECTION")?.id;
    expect(applicationId).toBeTruthy();

    requestApplicantCorrection({
      applicationId: applicationId as string,
      message: "Replace the back label image.",
      fields: ["backLabel"]
    });
    expect(getSnapshot().applications.find((application) => application.id === applicationId)?.metadata.correctionMessage).toContain("Replace");

    const snapshot = respondToApplicantCorrection({ applicationId: applicationId as string, response: "Uploaded corrected back label." });
    const application = snapshot.applications.find((candidate) => candidate.id === applicationId);
    expect(application?.status).toBe("RESUBMITTED");
    expect(application?.metadata.correctionResponse).toContain("corrected");
  });

  it("blocks applicant role from reviewer and admin resources", () => {
    expect(canAccess("applicant", "applications", "create")).toBe(true);
    expect(canAccess("applicant", "reviews", "list")).toBe(false);
    expect(canAccess("applicant", "workers", "manage")).toBe(false);
  });
});
