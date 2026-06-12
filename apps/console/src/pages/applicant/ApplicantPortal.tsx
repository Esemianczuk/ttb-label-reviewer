import { DeleteOutlined, FileAddOutlined, FileDoneOutlined, FormOutlined, InboxOutlined, UndoOutlined, WarningOutlined } from "@ant-design/icons";
import { Button, Card, Col, Popconfirm, Row, Space, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { ApplicationProgressTracker } from "../../components/application/ApplicationProgressTracker";
import { GovEmptyState } from "../../components/common/GovEmptyState";
import { GovMetricCard } from "../../components/common/GovMetricCard";
import { PdfExportButton } from "../../components/common/PdfExportButton";
import { StatusTag } from "../../components/common/StatusTag";
import { applicationNumberFor } from "../../domain/application/applicationNumber";
import type { ReviewApplication } from "../../domain/application/types";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { GovPageShell } from "../../layouts/GovPageShell";
import { archiveApplicantApplication, deleteApplicantDraft, setActiveApplication, submitApplicantApplication, unarchiveApplicantApplication } from "../../providers/data/browserStore";
import { readinessIssues } from "./applicantUtils";

export type ApplicantPortalView = "all" | "drafts" | "submitted" | "attention" | "archived";

const submittedStatuses = ["SUBMITTED", "RESUBMITTED", "IN_REVIEW", "APPROVED", "CONDITIONALLY_APPROVED", "REJECTED", "WITHDRAWN"];
const draftStatuses = ["DRAFT", "READY_TO_SUBMIT"];
const attentionStatuses = ["NEEDS_CORRECTION", "APPLICANT_FIX_REQUIRED"];

export function ApplicantPortal({ view = "all" }: { view?: ApplicantPortalView }) {
  const { snapshot } = useConsoleStore();
  const navigate = useNavigate();
  const applications = snapshot.applications;
  const activeApplications = useMemo(() => applications.filter((application) => application.status !== "ARCHIVED"), [applications]);
  const archivedApplications = useMemo(() => applications.filter((application) => application.status === "ARCHIVED"), [applications]);
  const draftApplications = activeApplications.filter((application) => draftStatuses.includes(application.status));
  const attentionApplications = activeApplications.filter((application) => attentionStatuses.includes(application.status));
  const submittedApplications = activeApplications.filter((application) => submittedStatuses.includes(application.status));
  const approved = activeApplications.filter((application) => ["APPROVED", "CONDITIONALLY_APPROVED"].includes(application.status));
  const visibleApplications = useMemo(() => {
    if (view === "drafts") return draftApplications;
    if (view === "submitted") return submittedApplications;
    if (view === "attention") return attentionApplications;
    if (view === "archived") return archivedApplications;
    return activeApplications;
  }, [activeApplications, archivedApplications, attentionApplications, draftApplications, submittedApplications, view]);
  const listTitle = titleForView(view);

  return (
    <GovPageShell
      title="Applicant Workspace"
      eyebrow="Applicant"
      description="Create a label review packet, upload label images, submit it for reviewer action, and respond when a reviewer requests changes."
      primaryAction={
        <Button type="primary" icon={<FileAddOutlined />} onClick={() => navigate("/applicant/applications/new")}>
          Create application packet
        </Button>
      }
    >
      <Space orientation="vertical" className="full-width" size={16}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <GovMetricCard
              title="Drafts"
              value={draftApplications.length}
              icon={<FormOutlined />}
              onClick={() => navigate("/applicant/drafts")}
              ariaLabel={`${draftApplications.length} drafts. Open drafts folder`}
            />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <GovMetricCard
              title="Submitted"
              value={submittedApplications.length}
              icon={<FileDoneOutlined />}
              onClick={() => navigate("/applicant/submitted")}
              ariaLabel={`${submittedApplications.length} submitted applications. Open submitted folder`}
            />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <GovMetricCard
              title="Needs attention"
              value={attentionApplications.length}
              icon={<WarningOutlined />}
              danger={attentionApplications.length > 0}
              onClick={() => navigate("/applicant/attention")}
              ariaLabel={`${attentionApplications.length} applications need attention. Open needs attention folder`}
            />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <GovMetricCard title="Approved" value={approved.length} icon={<FileDoneOutlined />} />
          </Col>
        </Row>

      <Card
        size="small"
        title={listTitle}
        extra={
          <Button icon={view === "archived" ? <FormOutlined /> : <InboxOutlined />} onClick={() => navigate(view === "archived" ? "/applicant" : "/applicant/archived")}>
            {view === "archived" ? "View active" : `View archived (${archivedApplications.length})`}
          </Button>
        }
      >
        <ApplicantApplicationTable applications={visibleApplications} view={view} />
      </Card>
      </Space>
    </GovPageShell>
  );
}

export function ApplicantApplicationTable({ applications, view = "all" }: { applications: ReviewApplication[]; view?: ApplicantPortalView }) {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const columns: ColumnsType<ReviewApplication> = [
    {
      title: "Application",
      render: (_, application) => (
        <Space orientation="vertical" size={1}>
          <strong>{application.title}</strong>
          <Typography.Text type="secondary">Application # {applicationNumberFor(application)}</Typography.Text>
        </Space>
      )
    },
    { title: "Images", render: (_, application) => application.images.length },
    { title: "Brand", render: (_, application) => application.expectedFields.brandName },
    { title: "Status", render: (_, application) => <StatusTag status={application.status} /> },
    {
      title: "Actions",
      width: 360,
      render: (_, application) => <ApplicantRowActions application={application} view={view} onMessage={messageApi} />
    }
  ];

  return (
    <>
      {contextHolder}
      <Table
        rowKey="id"
        dataSource={applications}
        columns={columns}
        locale={{
          emptyText: (
            <GovEmptyState
              title={emptyTitleForView(view)}
              description={emptyDescriptionForView(view)}
              action={
                view === "archived" ? undefined : (
                  <Button type="primary" icon={<FileAddOutlined />} onClick={() => navigate("/applicant/applications/new")}>
                    Create application packet
                  </Button>
                )
              }
            />
          )
        }}
        pagination={{ pageSize: 7 }}
        expandable={{
          expandedRowRender: (application) => <ApplicationProgressTracker status={application.status} />
        }}
        scroll={{ x: 960 }}
      />
    </>
  );
}

function ApplicantRowActions({
  application,
  view,
  onMessage
}: {
  application: ReviewApplication;
  view: ApplicantPortalView;
  onMessage: ReturnType<typeof message.useMessage>[0];
}) {
  const navigate = useNavigate();
  const isDraft = draftStatuses.includes(application.status);
  const needsAttention = attentionStatuses.includes(application.status);
  const openPath = isDraft || needsAttention ? `/applicant/applications/${application.id}/edit` : `/applicant/applications/${application.id}`;

  return (
    <Space wrap>
      <Button
        onClick={() => {
          setActiveApplication(application.id, "Applicant", "applicant");
          navigate(openPath);
        }}
      >
        {isDraft ? "Edit" : "Open"}
      </Button>
      {isDraft ? (
        <Button
          type="primary"
          onClick={() => {
            const issues = readinessIssues(application);
            if (issues.length) {
              onMessage.error(`Cannot submit yet: ${issues.join(" ")}`);
              return;
            }
            submitApplicantApplication(application.id);
            onMessage.success("Application submitted.");
          }}
        >
          Submit
        </Button>
      ) : null}
      {view === "drafts" && isDraft ? (
        <Popconfirm
          title="Delete this draft?"
          description="This removes the draft packet from the demo workspace."
          okText="Delete Draft"
          okButtonProps={{ danger: true }}
          onConfirm={() => {
            deleteApplicantDraft(application.id);
            onMessage.success("Draft deleted.");
          }}
        >
          <Button danger icon={<DeleteOutlined />}>
            Delete Draft
          </Button>
        </Popconfirm>
      ) : null}
      {needsAttention ? (
        <Button danger onClick={() => navigate(`/applicant/applications/${application.id}/edit`)}>
          Update Packet
        </Button>
      ) : null}
      {application.status === "ARCHIVED" ? (
        <Button
          icon={<UndoOutlined />}
          onClick={() => {
            unarchiveApplicantApplication(application.id);
            onMessage.success("Application restored to active packets.");
          }}
        >
          Unarchive
        </Button>
      ) : (
        <Button
          icon={<InboxOutlined />}
          onClick={() => {
            archiveApplicantApplication(application.id);
            onMessage.success("Application archived.");
          }}
        >
          Archive
        </Button>
      )}
      <PdfExportButton application={application} pageName="Applicant Packet" />
    </Space>
  );
}

function titleForView(view: ApplicantPortalView): string {
  if (view === "drafts") return "Drafts";
  if (view === "submitted") return "Submitted applications";
  if (view === "attention") return "Needs attention";
  if (view === "archived") return "Archived application packets";
  return "Application packets";
}

function emptyTitleForView(view: ApplicantPortalView): string {
  if (view === "drafts") return "No drafts";
  if (view === "submitted") return "No submitted applications";
  if (view === "attention") return "No applications need attention";
  if (view === "archived") return "No archived applications";
  return "No applications yet";
}

function emptyDescriptionForView(view: ApplicantPortalView): string {
  if (view === "drafts") return "Drafts appear here automatically as soon as you start a new application packet.";
  if (view === "submitted") return "Submitted packets, in-review applications, and decisions will appear here.";
  if (view === "attention") return "Reviewer correction requests will appear here with a direct update path.";
  if (view === "archived") return "Archived packets will appear here after you archive them from the active application list.";
  return "Create your first label review packet and submit it for reviewer action.";
}
