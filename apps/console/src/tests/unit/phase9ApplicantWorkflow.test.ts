import { describe, expect, it } from "vitest";
import { applicationNumberFor } from "../../domain/application/applicationNumber";
import type { ExpectedFields, LabelImage } from "../../domain/application/types";
import { canAccess } from "../../providers/access/permissionMatrix";
import {
  archiveApplicantApplication,
  autosaveApplicantDraft,
  createApplicantDraft,
  deleteApplicantDraft,
  getSnapshot,
  requestApplicantCorrection,
  resetSnapshot,
  resubmitApplicantApplication,
  submitApplicantApplication,
  unarchiveApplicantApplication
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
  it("assigns stable public application numbers to demo and applicant-created packets", () => {
    resetSnapshot();
    const firstDemoApplication = getSnapshot().applications[0];
    expect(applicationNumberFor(firstDemoApplication)).toBe("TTB-2026-0001");

    const draftSnapshot = createApplicantDraft({ expectedFields, images, submitter: "Applicant" });
    const draft = draftSnapshot.applications.find((application) => application.id === draftSnapshot.activeApplicationId);
    expect(applicationNumberFor(draft)).toMatch(/^TTB-2026-\d{4}$/);
    expect(draftSnapshot.auditEvents[0]).toMatchObject({
      action: "application.save_draft",
      metadata: {
        applicationId: draft?.id,
        applicationNumber: applicationNumberFor(draft)
      }
    });
    expect(draftSnapshot.auditEvents[0].summary).toContain(applicationNumberFor(draft));
  });

  it("creates a multi-image draft and submits it for reviewer action", () => {
    resetSnapshot();
    const draftSnapshot = createApplicantDraft({ expectedFields, images, submitter: "Applicant" });
    const applicationId = draftSnapshot.activeApplicationId;
    expect(draftSnapshot.applications[0].images).toHaveLength(2);
    expect(draftSnapshot.applications[0].status).toBe("DRAFT");

    const submitted = submitApplicantApplication(applicationId);
    expect(submitted.applications[0].status).toBe("SUBMITTED");
    expect(submitted.applications[0].review).toBeUndefined();
  });

  it("preserves correction request history and resubmits updated application fields", () => {
    resetSnapshot();
    const applicationId = getSnapshot().applications.find((application) => application.status === "NEEDS_CORRECTION")?.id;
    expect(applicationId).toBeTruthy();

    requestApplicantCorrection({
      applicationId: applicationId as string,
      message: "Replace the back label image.",
      fields: ["backLabel"]
    });
    expect(getSnapshot().applications.find((application) => application.id === applicationId)?.metadata.correctionMessage).toContain("Replace");

    const snapshot = resubmitApplicantApplication({
      applicationId: applicationId as string,
      expectedFields: { ...expectedFields, brandName: "PHASE NINE UPDATED" },
      images,
      submitter: "Applicant",
      notes: "Uploaded corrected back label."
    });
    const application = snapshot.applications.find((candidate) => candidate.id === applicationId);
    expect(application?.status).toBe("RESUBMITTED");
    expect(application?.expectedFields.brandName).toBe("PHASE NINE UPDATED");
    expect(application?.metadata.notes).toContain("corrected");
    expect(snapshot.auditEvents[0].action).toBe("application.resubmit");
  });

  it("blocks applicant role from reviewer and admin resources", () => {
    expect(canAccess("applicant", "applications", "create")).toBe(true);
    expect(canAccess("applicant", "applications", "delete")).toBe(true);
    expect(canAccess("applicant", "applications", "resubmit")).toBe(true);
    expect(canAccess("applicant", "applications", "archive")).toBe(true);
    expect(canAccess("applicant", "applications", "unarchive")).toBe(true);
    expect(canAccess("applicant", "reviews", "list")).toBe(false);
    expect(canAccess("applicant", "workers", "manage")).toBe(false);
  });

  it("autosaves a single draft and lets applicants delete it", () => {
    resetSnapshot();
    const first = autosaveApplicantDraft({ expectedFields, images: [], submitter: "Applicant", notes: "Started in the wizard." });
    const draftId = first.activeApplicationId;
    expect(first.applications.find((application) => application.id === draftId)?.status).toBe("DRAFT");
    expect(first.auditEvents[0].action).toBe("application.autosave_draft");

    const second = autosaveApplicantDraft({
      applicationId: draftId,
      expectedFields: { ...expectedFields, brandName: "PHASE NINE UPDATED" },
      images,
      submitter: "Applicant",
      notes: "Autosaved update."
    });
    const updatedDraft = second.applications.find((application) => application.id === draftId);
    expect(updatedDraft?.expectedFields.brandName).toBe("PHASE NINE UPDATED");
    expect(updatedDraft?.images).toHaveLength(2);
    expect(second.applications.filter((application) => application.id === draftId)).toHaveLength(1);

    const deleted = deleteApplicantDraft(draftId);
    expect(deleted.applications.find((application) => application.id === draftId)).toBeUndefined();
    expect(deleted.auditEvents[0].action).toBe("application.delete_draft");
  });

  it("archives applicant packets and restores their previous status", () => {
    resetSnapshot();
    const application = getSnapshot().applications.find((candidate) => candidate.status === "SUBMITTED");
    expect(application).toBeTruthy();

    const archived = archiveApplicantApplication(application!.id);
    const archivedApplication = archived.applications.find((candidate) => candidate.id === application!.id);
    expect(archivedApplication?.status).toBe("ARCHIVED");
    expect(archivedApplication?.metadata.archivedFromStatus).toBe("SUBMITTED");
    expect(archived.auditEvents[0].action).toBe("application.archive");

    const restored = unarchiveApplicantApplication(application!.id);
    const restoredApplication = restored.applications.find((candidate) => candidate.id === application!.id);
    expect(restoredApplication?.status).toBe("SUBMITTED");
    expect(restoredApplication?.metadata.archivedFromStatus).toBeUndefined();
    expect(restored.auditEvents[0].action).toBe("application.unarchive");
  });
});
