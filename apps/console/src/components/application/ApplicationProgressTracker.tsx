import { Steps } from "antd";
import type { ApplicationStatus } from "../../domain/application/types";
import { APPLICATION_WORKFLOW_MILESTONES, workflowMilestoneIndex, workflowStepState } from "../../domain/application/workflow";

export function ApplicationProgressTracker({ status }: { status: ApplicationStatus }) {
  const current = workflowMilestoneIndex(status);
  return (
    <Steps
      className="application-progress"
      current={current}
      size="small"
      responsive
      items={APPLICATION_WORKFLOW_MILESTONES.map((milestone, index) => ({
        title: milestone.title,
        status: workflowStepState(status, index)
      }))}
    />
  );
}
