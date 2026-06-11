import { CheckCircleOutlined, SendOutlined, ToolOutlined } from "@ant-design/icons";
import { Alert, Button, Card, List, Space, Typography, message } from "antd";
import { Link, useParams } from "react-router";
import { ApplicationProgressTracker } from "../../components/application/ApplicationProgressTracker";
import { StatusTag } from "../../components/common/StatusTag";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { runApplicantPrecheck, submitApplicantApplication } from "../../providers/data/browserStore";
import { readinessIssues } from "./applicantUtils";
import { ReviewFieldTable } from "./ApplicantApplicationDetail";

export function PrecheckPage() {
  const { applicationId } = useParams();
  const { snapshot } = useConsoleStore();
  const [messageApi, contextHolder] = message.useMessage();
  const application = snapshot.applications.find((candidate) => candidate.id === applicationId);

  if (!application) return <Card size="small">Application not found.</Card>;

  const issues = readinessIssues(application);
  const canSubmit = application.status === "READY_TO_SUBMIT";

  return (
    <Space orientation="vertical" className="full-width" size={16}>
      {contextHolder}
      <Card
        size="small"
        title={`${application.title} Pre-check`}
        extra={<StatusTag status={application.status} />}
      >
        <ApplicationProgressTracker status={application.status} />
      </Card>
      <Card size="small" title="Submission Readiness">
        {issues.length ? (
          <Alert type="warning" showIcon message="Fix required" description={issues.join(" ")} />
        ) : (
          <Alert type="success" showIcon message="Ready to submit" />
        )}
      </Card>
      <Card size="small" title="Automated Field Review">
        {application.review ? <ReviewFieldTable application={application} /> : <Typography.Text>No pre-check result yet.</Typography.Text>}
      </Card>
      <Card size="small">
        <Space wrap>
          <Button
            icon={<ToolOutlined />}
            onClick={() => {
              runApplicantPrecheck(application.id, snapshot.processingMode);
              messageApi.success("Pre-check completed.");
            }}
          >
            Run Pre-check
          </Button>
          <Button
            type="primary"
            icon={canSubmit ? <SendOutlined /> : <CheckCircleOutlined />}
            disabled={!canSubmit}
            onClick={() => {
              submitApplicantApplication(application.id);
              messageApi.success("Application submitted.");
            }}
          >
            Submit Application
          </Button>
          <Button>
            <Link to={`/applicant/applications/${application.id}`}>Application Detail</Link>
          </Button>
        </Space>
      </Card>
      {application.review?.fields.some((field) => field.status !== "PASS") ? (
        <Card size="small" title="Fields Needing Attention">
          <List
            dataSource={application.review.fields.filter((field) => field.status !== "PASS")}
            renderItem={(field) => <List.Item>{field.label}: {field.reason}</List.Item>}
          />
        </Card>
      ) : null}
    </Space>
  );
}
