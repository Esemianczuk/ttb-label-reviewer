import type { ApplicationStatus } from "./types";

export type WorkflowMilestone = {
  key: string;
  title: string;
  statuses: ApplicationStatus[];
};

export const APPLICATION_WORKFLOW_MILESTONES: WorkflowMilestone[] = [
  { key: "draft", title: "Draft", statuses: ["DRAFT", "PRECHECK_RUNNING", "APPLICANT_FIX_REQUIRED", "READY_TO_SUBMIT"] },
  { key: "submitted", title: "Submitted", statuses: ["SUBMITTED", "RESUBMITTED"] },
  { key: "review", title: "Review", statuses: ["IN_REVIEW", "NEEDS_CORRECTION"] },
  { key: "decision", title: "Decision", statuses: ["CONDITIONALLY_APPROVED", "APPROVED", "REJECTED", "WITHDRAWN"] },
  { key: "archive", title: "Archive", statuses: ["ARCHIVED"] }
];

export function workflowMilestoneIndex(status: ApplicationStatus): number {
  const index = APPLICATION_WORKFLOW_MILESTONES.findIndex((milestone) => milestone.statuses.includes(status));
  return index >= 0 ? index : 0;
}

export function workflowStepState(status: ApplicationStatus, milestoneIndex: number): "wait" | "process" | "finish" | "error" {
  const current = workflowMilestoneIndex(status);
  if (status === "APPLICANT_FIX_REQUIRED" || status === "NEEDS_CORRECTION" || status === "REJECTED") {
    return milestoneIndex === current ? "error" : milestoneIndex < current ? "finish" : "wait";
  }
  if (status === "WITHDRAWN") {
    return milestoneIndex === current ? "wait" : milestoneIndex < current ? "finish" : "wait";
  }
  if (milestoneIndex < current) return "finish";
  if (milestoneIndex === current) return "process";
  return "wait";
}
