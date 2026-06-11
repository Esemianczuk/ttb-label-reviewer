import {
  ClockCircleOutlined,
  FileAddOutlined,
  FileDoneOutlined,
  FormOutlined,
  InboxOutlined,
  WarningOutlined
} from "@ant-design/icons";
import { Button, Card, Col, Row, Space, Statistic, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Link, useNavigate } from "react-router";
import { ApplicationProgressTracker } from "../../components/application/ApplicationProgressTracker";
import { PdfExportButton } from "../../components/common/PdfExportButton";
import { StatusTag } from "../../components/common/StatusTag";
import type { ProcessingMode, ReviewApplication } from "../../domain/application/types";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { runApplicantPrecheckWithBrowserOcr, setActiveApplication, submitApplicantApplication } from "../../providers/data/browserStore";

export function ApplicantPortal() {
  const { snapshot } = useConsoleStore();
  const applications = snapshot.applications;
  const corrections = applications.filter((application) => application.status === "NEEDS_CORRECTION");
  const ready = applications.filter((application) => application.status === "READY_TO_SUBMIT");
  const submitted = applications.filter((application) => ["SUBMITTED", "RESUBMITTED", "IN_REVIEW"].includes(application.status));

  return (
    <Space orientation="vertical" className="full-width" size={16}>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="Drafts" value={applications.filter((application) => application.status === "DRAFT").length} prefix={<FormOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="Ready" value={ready.length} prefix={<FileDoneOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="Submitted" value={submitted.length} prefix={<InboxOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="Corrections" value={corrections.length} prefix={<WarningOutlined />} valueStyle={{ color: corrections.length ? "#b42318" : undefined }} />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title="Applicant Workspace"
        extra={
          <Space wrap>
            <Button icon={<ClockCircleOutlined />}>
              <Link to="/applicant/onboarding">Onboarding</Link>
            </Button>
            <Button type="primary" icon={<FileAddOutlined />}>
              <Link to="/applicant/applications/new">New Application</Link>
            </Button>
          </Space>
        }
      >
        <ApplicantApplicationTable applications={applications} mode={snapshot.processingMode} />
      </Card>
    </Space>
  );
}

export function ApplicantApplicationTable({ applications, mode }: { applications: ReviewApplication[]; mode: ProcessingMode }) {
  const navigate = useNavigate();
  const columns: ColumnsType<ReviewApplication> = [
    {
      title: "Application",
      render: (_, application) => (
        <Space orientation="vertical" size={1}>
          <strong>{application.title}</strong>
          <Typography.Text type="secondary">{application.expectedFields.applicationId || application.id}</Typography.Text>
        </Space>
      )
    },
    { title: "Images", render: (_, application) => application.images.length },
    { title: "Brand", render: (_, application) => application.expectedFields.brandName },
    { title: "Status", render: (_, application) => <StatusTag status={application.status} /> },
    {
      title: "Actions",
      width: 360,
      render: (_, application) => (
        <Space wrap>
          <Button
            onClick={() => {
              setActiveApplication(application.id, "Applicant", "applicant");
              navigate(`/applicant/applications/${application.id}`);
            }}
          >
            Open
          </Button>
          <Button onClick={() => navigate(`/applicant/applications/${application.id}/precheck`)}>Pre-check</Button>
          {application.status === "READY_TO_SUBMIT" ? (
            <Button type="primary" onClick={() => submitApplicantApplication(application.id)}>
              Submit
            </Button>
          ) : null}
          {application.status === "DRAFT" ? (
            <Button
              onClick={() =>
                void runApplicantPrecheckWithBrowserOcr(application.id, mode).catch((error) =>
                  message.error(error instanceof Error ? error.message : "Pre-check failed.")
                )
              }
            >
              Run
            </Button>
          ) : null}
          {application.status === "NEEDS_CORRECTION" ? (
            <Button danger onClick={() => navigate(`/applicant/applications/${application.id}/corrections`)}>
              Corrections
            </Button>
          ) : null}
          <PdfExportButton application={application} pageName="Applicant Packet" />
        </Space>
      )
    }
  ];

  return (
    <Table
      rowKey="id"
      dataSource={applications}
      columns={columns}
      pagination={{ pageSize: 7 }}
      expandable={{
        expandedRowRender: (application) => <ApplicationProgressTracker status={application.status} />
      }}
      scroll={{ x: 960 }}
    />
  );
}
