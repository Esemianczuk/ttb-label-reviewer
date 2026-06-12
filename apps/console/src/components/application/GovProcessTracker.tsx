import { Steps } from "antd";
import type { ApplicationStatus } from "../../domain/application/types";
import { APPLICATION_WORKFLOW_MILESTONES, workflowMilestoneIndex, workflowStepState } from "../../domain/application/workflow";

const reviewerSteps = ["Submitted", "In review", "Evidence checked", "Decision", "Closed"];

export function GovProcessTracker({
  status,
  flow = "applicant",
  evidenceChecked = false,
  decisionOpen = false
}: {
  status: ApplicationStatus;
  flow?: "applicant" | "reviewer";
  evidenceChecked?: boolean;
  decisionOpen?: boolean;
}) {
  const items =
    flow === "reviewer"
      ? reviewerSteps.map((title, index) => ({
          title,
          status: reviewerStepState(status, index, evidenceChecked, decisionOpen)
        }))
      : APPLICATION_WORKFLOW_MILESTONES.map((milestone, index) => ({
          title: milestone.title,
          status: workflowStepState(status, index)
        }));
  const current = flow === "reviewer" ? reviewerIndex(status, evidenceChecked, decisionOpen) : workflowMilestoneIndex(status);
  return <Steps className="gov-process-tracker application-progress" current={current} size="small" responsive items={items} />;
}

function reviewerIndex(status: ApplicationStatus, evidenceChecked: boolean, decisionOpen: boolean): number {
  if (["APPROVED", "REJECTED", "ARCHIVED", "WITHDRAWN", "CONDITIONALLY_APPROVED"].includes(status)) return 4;
  if (decisionOpen) return 3;
  if (["IN_REVIEW", "NEEDS_CORRECTION", "RESUBMITTED"].includes(status)) return evidenceChecked ? 2 : 1;
  if (status === "SUBMITTED") return 1;
  return 0;
}

function reviewerStepState(status: ApplicationStatus, index: number, evidenceChecked: boolean, decisionOpen: boolean): "wait" | "process" | "finish" | "error" {
  if (status === "REJECTED" && index === 4) return "error";
  const current = reviewerIndex(status, evidenceChecked, decisionOpen);
  if (index < current) return "finish";
  if (index === current) return "process";
  return "wait";
}
