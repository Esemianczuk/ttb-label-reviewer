import { describe, expect, it } from "vitest";
import {
  applicantReadinessStatusFromCompliance,
  backendModeFromProcessingMode,
  displayStatus,
  normalizeApplicationStatus,
  normalizeReviewRunStatus,
  normalizeReviewStatus,
  reviewerWorkflowStatusFromCompliance
} from "../../domain/application/status";
import { workflowMilestoneIndex, workflowStepState } from "../../domain/application/workflow";

describe("canonical status converters", () => {
  it("normalizes legacy API application statuses", () => {
    expect(normalizeApplicationStatus("created")).toBe("DRAFT");
    expect(normalizeApplicationStatus("assets_uploaded")).toBe("READY_TO_SUBMIT");
    expect(normalizeApplicationStatus("review_queued")).toBe("IN_REVIEW");
    expect(normalizeApplicationStatus("review_completed")).toBe("IN_REVIEW");
    expect(normalizeApplicationStatus("review_failed")).toBe("IN_REVIEW");
    expect(normalizeApplicationStatus("pass")).toBe("READY_TO_SUBMIT");
    expect(normalizeApplicationStatus("fail")).toBe("APPLICANT_FIX_REQUIRED");
  });

  it("normalizes compliance statuses without accepting run lifecycle shortcuts", () => {
    expect(normalizeReviewStatus("pass")).toBe("PASS");
    expect(normalizeReviewStatus("completed")).toBe("NEEDS_REVIEW");
    expect(normalizeReviewStatus("failed")).toBe("NEEDS_REVIEW");
    expect(normalizeReviewStatus("pass_with_warning")).toBe("PASS_WITH_WARNINGS");
    expect(normalizeReviewStatus("queued")).toBe("NEEDS_REVIEW");
  });

  it("normalizes review-run lifecycle separately from compliance", () => {
    expect(normalizeReviewRunStatus("completed")).toBe("COMPLETED");
    expect(normalizeReviewRunStatus("processing")).toBe("RUNNING");
    expect(normalizeReviewRunStatus("pass")).toBe("QUEUED");
  });

  it("keeps applicant readiness and reviewer workflow status explicit", () => {
    expect(applicantReadinessStatusFromCompliance("PASS")).toBe("READY_TO_SUBMIT");
    expect(applicantReadinessStatusFromCompliance("FAIL")).toBe("APPLICANT_FIX_REQUIRED");
    expect(reviewerWorkflowStatusFromCompliance("PASS")).toBe("IN_REVIEW");
    expect(reviewerWorkflowStatusFromCompliance("FAIL")).toBe("IN_REVIEW");
  });

  it("keeps display and backend mode conversions separate from stored statuses", () => {
    expect(displayStatus("NEEDS_CORRECTION")).toBe("Needs Correction");
    expect(backendModeFromProcessingMode("cluster")).toBe("distributed");
    expect(backendModeFromProcessingMode("backend")).toBe("backend");
  });

  it("maps canonical application states into progress tracker milestones", () => {
    expect(workflowMilestoneIndex("DRAFT")).toBe(0);
    expect(workflowMilestoneIndex("PRECHECK_RUNNING")).toBe(0);
    expect(workflowMilestoneIndex("RESUBMITTED")).toBe(1);
    expect(workflowMilestoneIndex("NEEDS_CORRECTION")).toBe(2);
    expect(workflowMilestoneIndex("APPROVED")).toBe(3);
    expect(workflowMilestoneIndex("ARCHIVED")).toBe(4);
    expect(workflowStepState("NEEDS_CORRECTION", 2)).toBe("error");
  });
});
