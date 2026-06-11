import { describe, expect, it } from "vitest";
import {
  acceptAutoReview,
  autoReviewApplication,
  finalizeReviewerDecision,
  getSnapshot,
  requestApplicantCorrection,
  resetSnapshot,
  updateFieldDecision
} from "../../providers/data/browserStore";
import { matchesReviewerFilter, unresolvedCriticalFailures } from "../../pages/reviewer/reviewerUtils";

describe("phase 10 reviewer workflow", () => {
  it("requires a note when changing a pass field to fail", () => {
    resetSnapshot();
    const applicationId = getSnapshot().applications[0].id;
    autoReviewApplication(applicationId, "browser");
    const fieldId = getSnapshot().applications[0].review?.fields[0].id as string;

    expect(() => updateFieldDecision({ applicationId, fieldId, status: "FAIL" })).toThrow(/Override note is required/i);

    updateFieldDecision({ applicationId, fieldId, status: "FAIL", reason: "Reviewer found a label conflict." });
    const field = getSnapshot().applications[0].review?.fields[0];
    expect(field?.reviewerStatus).toBe("FAIL");
    expect(getSnapshot().auditEvents[0].action).toBe("review.field_override");
  });

  it("blocks approval while critical failures are unresolved, then approves after override", () => {
    resetSnapshot();
    const applicationId = "app-riverlight-rye-whiskey";
    autoReviewApplication(applicationId, "browser");
    let application = getSnapshot().applications.find((candidate) => candidate.id === applicationId);
    expect(unresolvedCriticalFailures(application!)).toHaveLength(1);

    expect(() => finalizeReviewerDecision({ applicationId, decision: "approve" })).toThrow(/Approve is blocked/i);

    const alcoholFieldId = application?.review?.fields.find((field) => field.fieldKey === "alcoholContent")?.id as string;
    updateFieldDecision({ applicationId, fieldId: alcoholFieldId, status: "PASS", reason: "Applicant supplied corrected ABV support." });
    finalizeReviewerDecision({ applicationId, decision: "approve", note: "Critical mismatch resolved." });

    application = getSnapshot().applications.find((candidate) => candidate.id === applicationId);
    expect(application?.status).toBe("APPROVED");
    expect(application?.metadata.reviewerDecision).toBe("approved");
  });

  it("requires a correction message and stores requested fields", () => {
    resetSnapshot();
    const applicationId = "app-sundaze-hard-seltzer";
    expect(() => requestApplicantCorrection({ applicationId, message: "   ", fields: [] })).toThrow(/require a message/i);

    requestApplicantCorrection({ applicationId, message: "Confirm the warning panel.", fields: ["governmentWarning"] });
    const application = getSnapshot().applications.find((candidate) => candidate.id === applicationId);
    expect(application?.status).toBe("NEEDS_CORRECTION");
    expect(application?.metadata.correctionFields).toEqual(["governmentWarning"]);
    expect(getSnapshot().auditEvents[0].action).toBe("correction.request");
  });

  it("accepts a high-confidence auto result and records the reviewer decision", () => {
    resetSnapshot();
    const applicationId = "app-highland-coast-lightkeeper-gin";
    autoReviewApplication(applicationId, "browser");
    acceptAutoReview(applicationId);
    const application = getSnapshot().applications.find((candidate) => candidate.id === applicationId);
    expect(application?.status).toBe("APPROVED");
    expect(application?.metadata.reviewerDecision).toBe("accepted_auto");
    expect(getSnapshot().auditEvents[0].action).toBe("review.decision.accept_auto");
  });

  it("filters queue records for critical failures and high-confidence passes", () => {
    resetSnapshot();
    autoReviewApplication("app-riverlight-rye-whiskey", "browser");
    autoReviewApplication("app-highland-coast-lightkeeper-gin", "browser");
    const snapshot = getSnapshot();
    const riverlight = snapshot.applications.find((application) => application.id === "app-riverlight-rye-whiskey")!;
    const highland = snapshot.applications.find((application) => application.id === "app-highland-coast-lightkeeper-gin")!;

    expect(matchesReviewerFilter(riverlight, "critical_fail")).toBe(true);
    expect(matchesReviewerFilter(highland, "high_confidence_pass")).toBe(true);
  });
});
