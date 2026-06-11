import { CheckCircleOutlined, SendOutlined, ToolOutlined } from "@ant-design/icons";
import { Alert, Button, Card, List, Select, Space, Typography, message } from "antd";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { ApplicationProgressTracker } from "../../components/application/ApplicationProgressTracker";
import { StatusTag } from "../../components/common/StatusTag";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { browserOcrWorkerCountLabel, getBrowserOcrWorkerOverride, setBrowserOcrWorkerOverride } from "../../domain/application/browserOcrSettings";
import { runApplicantPrecheckWithBrowserOcr, submitApplicantApplication } from "../../providers/data/browserStore";
import { readinessIssues } from "./applicantUtils";
import { ReviewFieldTable } from "./ApplicantApplicationDetail";

export function PrecheckPage() {
  const { applicationId } = useParams();
  const { snapshot } = useConsoleStore();
  const [messageApi, contextHolder] = message.useMessage();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [workerOverride, setWorkerOverrideState] = useState(() => getBrowserOcrWorkerOverride());
  const application = snapshot.applications.find((candidate) => candidate.id === applicationId);

  if (!application) return <Card size="small">Application not found.</Card>;

  const issues = readinessIssues(application);
  const canSubmit = application.status === "READY_TO_SUBMIT";
  const workerLabel = browserOcrWorkerCountLabel(application.images.length, workerOverride);

  const updateWorkerOverride = (value: string) => {
    setWorkerOverrideState(setBrowserOcrWorkerOverride(value));
  };

  const runPrecheck = async () => {
    setRunning(true);
    setProgress("Preparing browser OCR.");
    try {
      await runApplicantPrecheckWithBrowserOcr(application.id, snapshot.processingMode, {
        workerOverride,
        onProgress: setProgress
      });
      messageApi.success("Pre-check completed.");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Pre-check failed.");
    } finally {
      setRunning(false);
    }
  };

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
        <Space orientation="vertical" className="full-width" size={12}>
          <Space wrap>
            <Typography.Text type="secondary">Browser OCR workers</Typography.Text>
            <Select
              aria-label="Browser OCR workers"
              value={workerOverride}
              onChange={updateWorkerOverride}
              disabled={running}
              options={[
                { value: "auto", label: "Auto" },
                { value: "1", label: "1" },
                { value: "2", label: "2" },
                { value: "3", label: "3" }
              ]}
              style={{ width: 120 }}
            />
            <Typography.Text type="secondary">{workerLabel}</Typography.Text>
          </Space>
          {progress ? <Typography.Text type="secondary">{progress}</Typography.Text> : null}
          {application.review ? <ReviewFieldTable application={application} /> : <Typography.Text>No pre-check result yet.</Typography.Text>}
        </Space>
      </Card>
      <Card size="small">
        <Space wrap>
          <Button
            icon={<ToolOutlined />}
            loading={running}
            onClick={() => void runPrecheck()}
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
