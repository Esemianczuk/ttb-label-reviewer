import { CheckCircleOutlined, CloseCircleOutlined, EditOutlined, SendOutlined, StopOutlined } from "@ant-design/icons";
import { Button, Card, Col, Descriptions, Image, Row, Space, Table, Typography } from "antd";
import { Navigate, useNavigate, useParams } from "react-router";
import { ApplicationProgressTracker } from "../../components/application/ApplicationProgressTracker";
import { PdfExportButton } from "../../components/common/PdfExportButton";
import { StatusTag } from "../../components/common/StatusTag";
import { applicationNumberFor } from "../../domain/application/applicationNumber";
import { fieldLabels } from "../../domain/application/demoData";
import type { ExpectedFields, ReviewApplication } from "../../domain/application/types";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { GovPageShell } from "../../layouts/GovPageShell";
import { submitApplicantApplication, withdrawApplicantApplication } from "../../providers/data/browserStore";
import { readinessIssues } from "./applicantUtils";

export function ApplicantApplicationDetail() {
  const { applicationId } = useParams();
  const { snapshot } = useConsoleStore();
  const navigate = useNavigate();
  const application = snapshot.applications.find((candidate) => candidate.id === applicationId);

  if (!application) {
    return (
      <Card size="small">
        <Typography.Text>Application not found.</Typography.Text>
      </Card>
    );
  }

  if (application.status === "NEEDS_CORRECTION") {
    return <Navigate to={`/applicant/applications/${application.id}/edit`} replace />;
  }

  const issues = readinessIssues(application);

  return (
    <GovPageShell
      title={application.title}
      eyebrow="Application packet"
      description="Review submitted application fields, uploaded label images, submission status, and correction requests."
      statusTag={<StatusTag status={application.status} />}
      primaryAction={<PdfExportButton application={application} pageName="Applicant Application" />}
    >
      <Space orientation="vertical" className="full-width" size={16}>
        <Card size="small" title="Application #">
          <Typography.Text strong>{applicationNumberFor(application)}</Typography.Text>
        </Card>
        <Card size="small" title="Application process">
          <ApplicationProgressTracker status={application.status} />
        </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={10}>
          <Card size="small" title="Label Images">
            <div className="image-evidence-list">
              {application.images.map((image) => (
                <div className="image-evidence-row" key={image.id}>
                  <Image src={image.url} alt={`${image.name} preview`} width={92} height={92} className="image-thumb" />
                  <Space orientation="vertical" size={2}>
                    <Typography.Text strong>{image.name}</Typography.Text>
                    <Typography.Text type="secondary">{image.role} {image.width && image.height ? `${image.width} x ${image.height}` : ""}</Typography.Text>
                  </Space>
                </div>
              ))}
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={14}>
          <Card size="small" title="Application Fields">
            <FieldSummary expectedFields={application.expectedFields} />
          </Card>
        </Col>
      </Row>

      <Card size="small" title="Readiness">
        {issues.length ? (
          <div className="simple-list">
            {issues.map((issue) => (
              <div className="simple-list-item" key={issue}><CloseCircleOutlined className="status-fail" /> {issue}</div>
            ))}
          </div>
        ) : (
          <Typography.Text><CheckCircleOutlined className="status-pass" /> Application is ready for submission.</Typography.Text>
        )}
      </Card>

      <Card size="small">
        <Space wrap>
          <Button icon={<EditOutlined />} onClick={() => navigate("/applicant/applications/new")}>
            Create New Version
          </Button>
          <Button
            icon={<SendOutlined />}
            type="primary"
            disabled={issues.length > 0 || !["DRAFT", "READY_TO_SUBMIT"].includes(application.status)}
            onClick={() => submitApplicantApplication(application.id)}
          >
            Submit
          </Button>
          <Button icon={<StopOutlined />} danger onClick={() => withdrawApplicantApplication(application.id)}>
            Withdraw
          </Button>
          <Button onClick={() => navigate(`/applicant/applications/${application.id}/timeline`)}>Timeline</Button>
        </Space>
      </Card>
      </Space>
    </GovPageShell>
  );
}

export function FieldSummary({ expectedFields }: { expectedFields: ExpectedFields }) {
  return (
    <Descriptions column={{ xs: 1, md: 2 }} bordered size="small">
      {(Object.entries(expectedFields) as Array<[keyof ExpectedFields, unknown]>).map(([key, value]) =>
        typeof value === "undefined" || value === "" ? null : (
          <Descriptions.Item key={key} label={fieldLabels[key] || key}>
            {String(value)}
          </Descriptions.Item>
        )
      )}
    </Descriptions>
  );
}

export function ReviewFieldTable({ application }: { application: ReviewApplication }) {
  return (
    <Table
      rowKey="id"
      dataSource={application.review?.fields || []}
      pagination={false}
      size="small"
      scroll={{ x: 760 }}
      columns={[
        { title: "Field", dataIndex: "label" },
        { title: "Expected", dataIndex: "expected", ellipsis: true },
        { title: "Detected", dataIndex: "extracted", ellipsis: true },
        { title: "Status", render: (_, field) => <StatusTag status={field.status} /> },
        { title: "Reason", dataIndex: "reason", ellipsis: true }
      ]}
    />
  );
}
