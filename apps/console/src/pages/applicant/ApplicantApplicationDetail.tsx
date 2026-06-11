import { CheckCircleOutlined, CloseCircleOutlined, EditOutlined, SendOutlined, StopOutlined } from "@ant-design/icons";
import { Button, Card, Col, Descriptions, Image, List, Row, Space, Table, Typography } from "antd";
import { Link, useNavigate, useParams } from "react-router";
import { ApplicationProgressTracker } from "../../components/application/ApplicationProgressTracker";
import { PdfExportButton } from "../../components/common/PdfExportButton";
import { StatusTag } from "../../components/common/StatusTag";
import { fieldLabels } from "../../domain/application/demoData";
import type { ExpectedFields, ReviewApplication } from "../../domain/application/types";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { runApplicantPrecheck, submitApplicantApplication, withdrawApplicantApplication } from "../../providers/data/browserStore";
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

  const issues = readinessIssues(application);

  return (
    <Space orientation="vertical" className="full-width" size={16}>
      <Card
        size="small"
        title={application.title}
        extra={
          <Space wrap>
            <StatusTag status={application.status} />
            <PdfExportButton application={application} pageName="Applicant Application" />
          </Space>
        }
      >
        <ApplicationProgressTracker status={application.status} />
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={10}>
          <Card size="small" title="Label Images">
            <List
              dataSource={application.images}
              renderItem={(image) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={<Image src={image.url} alt={`${image.name} preview`} width={92} height={92} className="image-thumb" />}
                    title={image.name}
                    description={`${image.role} ${image.width && image.height ? `${image.width} x ${image.height}` : ""}`}
                  />
                </List.Item>
              )}
            />
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
          <List size="small" dataSource={issues} renderItem={(issue) => <List.Item><CloseCircleOutlined className="status-fail" /> {issue}</List.Item>} />
        ) : (
          <Typography.Text><CheckCircleOutlined className="status-pass" /> Application is ready for pre-check or submission.</Typography.Text>
        )}
      </Card>

      <Card size="small">
        <Space wrap>
          <Button icon={<EditOutlined />}>
            <Link to="/applicant/applications/new">Create New Version</Link>
          </Button>
          <Button onClick={() => navigate(`/applicant/applications/${application.id}/precheck`)}>Pre-check</Button>
          <Button icon={<SendOutlined />} type="primary" disabled={application.status !== "READY_TO_SUBMIT"} onClick={() => submitApplicantApplication(application.id)}>
            Submit
          </Button>
          {application.status === "NEEDS_CORRECTION" ? (
            <Button danger onClick={() => navigate(`/applicant/applications/${application.id}/corrections`)}>
              Respond To Correction
            </Button>
          ) : null}
          <Button icon={<StopOutlined />} danger onClick={() => withdrawApplicantApplication(application.id)}>
            Withdraw
          </Button>
          <Button onClick={() => navigate(`/applicant/applications/${application.id}/timeline`)}>Timeline</Button>
          <Button onClick={() => runApplicantPrecheck(application.id, snapshot.processingMode)}>Run Pre-check</Button>
        </Space>
      </Card>
    </Space>
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
