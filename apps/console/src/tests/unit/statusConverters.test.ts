import { describe, expect, it } from "vitest";
import {
  applicationStatusFromReviewStatus,
  backendModeFromProcessingMode,
  displayStatus,
  normalizeApplicationStatus,
  normalizeReviewStatus
} from "../../domain/application/status";
import { workflowMilestoneIndex, workflowStepState } from "../../domain/application/workflow";

describe("canonical status converters", () => {
  it("normalizes legacy API application statuses", () => {
    expect(normalizeApplicationStatus("created")).toBe("DRAFT");
    expect(normalizeApplicationStatus("assets_uploaded")).toBe("READY_TO_SUBMIT");
    expect(normalizeApplicationStatus("review_queued")).toBe("IN_REVIEW");
    expect(normalizeApplicationStatus("review_completed")).toBe("APPROVED");
    expect(normalizeApplicationStatus("review_failed")).toBe("REJECTED");
  });

  it("normalizes legacy API review statuses", () => {
    expect(normalizeReviewStatus("pass")).toBe("PASS");
    expect(normalizeReviewStatus("completed")).toBe("PASS");
    expect(normalizeReviewStatus("failed")).toBe("FAIL");
    expect(normalizeReviewStatus("pass_with_warning")).toBe("PASS_WITH_WARNINGS");
    expect(normalizeReviewStatus("queued")).toBe("NEEDS_REVIEW");
  });

  it("rolls review status into applicant workflow status explicitly", () => {
    expect(applicationStatusFromReviewStatus("PASS")).toBe("APPROVED");
    expect(applicationStatusFromReviewStatus("FAIL")).toBe("REJECTED");
    expect(applicationStatusFromReviewStatus("NEEDS_REVIEW")).toBe("IN_REVIEW");
  });

  it("keeps display and backend mode conversions separate from stored statuses", () => {
    expect(displayStatus("NEEDS_CORRECTION")).toBe("Needs Correction");
    expect(backendModeFromProcessingMode("cluster")).toBe("distributed");
    expect(backendModeFromProcessingMode("backend")).toBe("backend");
  });

  it("maps canonical application states into progress tracker milestones", () => {
    expect(workflowMilestoneIndex("DRAFT")).toBe(0);
    expect(workflowMilestoneIndex("PRECHECK_RUNNING")).toBe(1);
    expect(workflowMilestoneIndex("RESUBMITTED")).toBe(2);
    expect(workflowMilestoneIndex("NEEDS_CORRECTION")).toBe(3);
    expect(workflowMilestoneIndex("APPROVED")).toBe(4);
    expect(workflowMilestoneIndex("ARCHIVED")).toBe(5);
    expect(workflowStepState("NEEDS_CORRECTION", 3)).toBe("error");
  });
});
