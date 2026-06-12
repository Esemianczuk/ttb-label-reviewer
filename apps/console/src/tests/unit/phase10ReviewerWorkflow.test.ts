import { describe, expect, it } from "vitest";
import {
  applicationNumberFor
} from "../../domain/application/applicationNumber";
import type { ExpectedFields, LabelImage } from "../../domain/application/types";
import {
  acceptAutoReview,
  autoReviewApplication,
  createApplicantDraft,
  finalizeReviewerDecision,
  getSnapshot,
  reopenReviewerDecision,
  requestApplicantCorrection,
  resetSnapshot,
  updateReviewNotes,
  updateFieldDecision
} from "../../providers/data/browserStore";
import { matchesReviewerFilter, unresolvedCriticalFailures } from "../../pages/reviewer/reviewerUtils";
import {
  readPendingAutoReviewApplicationId,
  readReviewerAutoRunPreference,
  writePendingAutoReviewApplicationId,
  writeReviewerAutoRunPreference
} from "../../components/review/ReviewWorkbench";

const realCriticalApplicationId = "app-ttb-19337001000251";
const realCorrectionApplicationId = "app-ttb-19350001000429";

const completeExpectedFields: ExpectedFields = {
  productType: "distilled_spirits",
  brandName: "CLEAN REVIEW",
  classType: "Distilled Spirits Specialty",
  alcoholContent: "40% Alc./Vol.",
  netContents: "750 mL",
  governmentWarningRequired: true,
  producerName: "Clean Review Spirits",
  countryOfOrigin: "United States",
  applicationId: "CLEAN-REVIEW"
};

const completeImages: LabelImage[] = [
  {
    id: "clean-review-front",
    role: "front",
    name: "clean-review-front.png",
    url: "/clean-review-front.png",
    mimeType: "image/png",
    source: "upload"
  }
];

function createHighConfidenceApplication(): string {
  return createApplicantDraft({
    expectedFields: completeExpectedFields,
    images: completeImages,
    submitter: "Clean Review Applicant"
  }).activeApplicationId;
}

describe("phase 10 reviewer workflow", () => {
  it("persists reviewer auto-run preference and next-application handoff state", () => {
    window.localStorage.removeItem("ttb-reviewer-auto-run-on-next");
    expect(readReviewerAutoRunPreference()).toBe(true);
    writeReviewerAutoRunPreference(false);
    expect(readReviewerAutoRunPreference()).toBe(false);
    writeReviewerAutoRunPreference(true);
    expect(readReviewerAutoRunPreference()).toBe(true);

    expect(readPendingAutoReviewApplicationId()).toBeNull();
    writePendingAutoReviewApplicationId("app-next-review");
    expect(readPendingAutoReviewApplicationId()).toBe("app-next-review");
    writePendingAutoReviewApplicationId(null);
    expect(readPendingAutoReviewApplicationId()).toBeNull();
  });

  it("allows changing a field between pass and fail without a required note", () => {
    resetSnapshot();
    const applicationId = getSnapshot().applications[0].id;
    autoReviewApplication(applicationId, "browser");
    const fieldId = getSnapshot().applications[0].review?.fields[0].id as string;
    expect(getSnapshot().applications[0].review?.fields[0].evidence[0].crop).toMatchObject({ unit: "ratio", source: "estimated" });
    expect(getSnapshot().applications[0].review?.fields.map((field) => field.fieldKey)).not.toContain("applicationId");
    expect(getSnapshot().applications[0].review?.fields.map((field) => field.fieldKey)).not.toContain("labelId");

    updateFieldDecision({ applicationId, fieldId, status: "FAIL" });
    const field = getSnapshot().applications[0].review?.fields[0];
    expect(field?.reviewerStatus).toBe("FAIL");
    expect(field?.reviewerReason).toBeUndefined();
    expect(getSnapshot().auditEvents[0].action).toBe("review.field_override");
    expect(getSnapshot().auditEvents[0].metadata?.applicationNumber).toBe(applicationNumberFor(getSnapshot().applications[0]));
    expect(getSnapshot().auditEvents[0].summary).toContain(applicationNumberFor(getSnapshot().applications[0]));
  });

  it("blocks approval while critical failures are unresolved, then approves after override", () => {
    resetSnapshot();
    const applicationId = realCriticalApplicationId;
    autoReviewApplication(applicationId, "browser");
    let application = getSnapshot().applications.find((candidate) => candidate.id === applicationId);
    const alcohol = application?.review?.fields.find((field) => field.fieldKey === "alcoholContent");
    const netContents = application?.review?.fields.find((field) => field.fieldKey === "netContents");
    if (!alcohol || !netContents) throw new Error("Expected audited alcohol and net contents fields.");
    alcohol.status = "FAIL";
    alcohol.severity = "critical";
    alcohol.reason = "Stress test mismatch: alcohol content requires reviewer resolution.";
    netContents.status = "FAIL";
    netContents.severity = "critical";
    netContents.reason = "Stress test mismatch: net contents requires reviewer resolution.";

    expect(unresolvedCriticalFailures(application!)).toHaveLength(2);

    expect(() => finalizeReviewerDecision({ applicationId, decision: "approve" })).toThrow(/Approve is blocked/i);

    const alcoholFieldId = application?.review?.fields.find((field) => field.fieldKey === "alcoholContent")?.id as string;
    updateFieldDecision({ applicationId, fieldId: alcoholFieldId, status: "PASS", reason: "Applicant supplied corrected ABV support." });
    const netContentsFieldId = application?.review?.fields.find((field) => field.fieldKey === "netContents")?.id as string;
    updateFieldDecision({ applicationId, fieldId: netContentsFieldId, status: "PASS", reason: "Applicant supplied net contents support." });
    finalizeReviewerDecision({ applicationId, decision: "approve", note: "Critical mismatch resolved." });

    application = getSnapshot().applications.find((candidate) => candidate.id === applicationId);
    expect(application?.status).toBe("APPROVED");
    expect(application?.metadata.reviewerDecision).toBe("approved");
  });

  it("locks closed reviewer decisions until they are reopened", () => {
    resetSnapshot();
    const applicationId = createHighConfidenceApplication();
    autoReviewApplication(applicationId, "browser");
    finalizeReviewerDecision({ applicationId, decision: "approve", note: "Clean evidence." });
    const closed = getSnapshot().applications.find((candidate) => candidate.id === applicationId);
    const fieldId = closed?.review?.fields[0].id as string;

    expect(closed?.status).toBe("APPROVED");
    expect(() => updateFieldDecision({ applicationId, fieldId, status: "FAIL" })).toThrow(/Reopen/i);
    expect(() => updateReviewNotes({ applicationId, reviewerNotes: "Changed after close." })).toThrow(/Reopen/i);

    reopenReviewerDecision(applicationId);
    const reopened = getSnapshot().applications.find((candidate) => candidate.id === applicationId);
    expect(reopened?.status).toBe("IN_REVIEW");
    expect(reopened?.metadata.reviewerDecision).toBeUndefined();
    expect(reopened?.metadata.reviewerDecisionReopened).toBe(true);
    updateFieldDecision({ applicationId, fieldId, status: "FAIL" });
    expect(getSnapshot().applications.find((candidate) => candidate.id === applicationId)?.review?.fields[0].reviewerStatus).toBe("FAIL");
  });

  it("requires a correction message and stores requested fields", () => {
    resetSnapshot();
    const applicationId = realCorrectionApplicationId;
    expect(() => requestApplicantCorrection({ applicationId, message: "   ", fields: [] })).toThrow(/require a message/i);

    requestApplicantCorrection({ applicationId, message: "Confirm the warning panel.", fields: ["governmentWarning"] });
    const application = getSnapshot().applications.find((candidate) => candidate.id === applicationId);
    expect(application?.status).toBe("NEEDS_CORRECTION");
    expect(application?.metadata.correctionFields).toEqual(["governmentWarning"]);
    expect(getSnapshot().auditEvents[0].action).toBe("correction.request");
  });

  it("accepts a high-confidence auto result without final approval", () => {
    resetSnapshot();
    const applicationId = createHighConfidenceApplication();
    autoReviewApplication(applicationId, "browser");
    acceptAutoReview(applicationId);
    const application = getSnapshot().applications.find((candidate) => candidate.id === applicationId);
    expect(application?.status).toBe("IN_REVIEW");
    expect(application?.metadata.reviewerDecision).toBe("accepted_auto");
    expect(getSnapshot().auditEvents[0].action).toBe("review.decision.accept_auto");
  });

  it("filters queue records for critical failures and high-confidence passes", () => {
    resetSnapshot();
    const highConfidenceApplicationId = createHighConfidenceApplication();
    autoReviewApplication(realCriticalApplicationId, "browser");
    autoReviewApplication(highConfidenceApplicationId, "browser");
    const snapshot = getSnapshot();
    const critical = snapshot.applications.find((application) => application.id === realCriticalApplicationId)!;
    const highConfidence = snapshot.applications.find((application) => application.id === highConfidenceApplicationId)!;
    const criticalAlcohol = critical.review?.fields.find((field) => field.fieldKey === "alcoholContent");
    if (!criticalAlcohol) throw new Error("Expected alcohol content field.");
    criticalAlcohol.status = "FAIL";
    criticalAlcohol.severity = "critical";

    expect(matchesReviewerFilter(critical, "critical_fail")).toBe(true);
    expect(matchesReviewerFilter(highConfidence, "high_confidence_pass")).toBe(true);
    expect(matchesReviewerFilter(critical, "ready_for_decision")).toBe(false);
    expect(matchesReviewerFilter(highConfidence, "ready_for_decision")).toBe(true);
    expect(matchesReviewerFilter(getSnapshot().applications.find((application) => application.id === realCorrectionApplicationId)!, "needs_review")).toBe(true);
  });
});
