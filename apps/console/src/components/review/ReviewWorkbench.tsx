import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
  PlayCircleOutlined,
  SendOutlined,
  StopOutlined,
  ToolOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Form,
  Image,
  Input,
  List,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Timeline,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { FieldStatus, LabelImage, ReviewApplication, ReviewField } from "../../domain/application/types";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import {
  acceptAutoReview,
  autoReviewApplicationWithBrowserOcr,
  finalizeReviewerDecision,
  requestApplicantCorrection,
  setActiveApplication,
  updateFieldDecision,
  updateReviewNotes
} from "../../providers/data/browserStore";
import { ApplicationProgressTracker } from "../application/ApplicationProgressTracker";
import { ImageWorkbench } from "../common/ImageWorkbench";
import { PdfExportButton } from "../common/PdfExportButton";
import { ModeTag, StatusTag } from "../common/StatusTag";
import { effectiveFieldStatus, unresolvedCriticalFailures } from "../../pages/reviewer/reviewerUtils";

export function ReviewWorkbench({ applicationId }: { applicationId?: string }) {
  const { snapshot, activeApplication, activeIndex, hasNext, hasPrevious } = useConsoleStore();
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedImageId, setSelectedImageId] = useState<string | undefined>();
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const application = applicationId ? snapshot.applications.find((candidate) => candidate.id === applicationId) : activeApplication;
  const selectedImage = application?.images.find((image) => image.id === selectedImageId) || application?.images[0];

  useEffect(() => {
    if (applicationId && applicationId !== snapshot.activeApplicationId) setActiveApplication(applicationId);
  }, [applicationId, snapshot.activeApplicationId]);

  useEffect(() => {
    if (application?.images[0] && !application.images.some((image) => image.id === selectedImageId)) {
      setSelectedImageId(application.images[0].id);
    }
  }, [application?.id, application?.images, selectedImageId]);

  const runAutoReview = useCallback(
    async (targetApplicationId: string, showSuccess = true) => {
      setReviewingId(targetApplicationId);
      try {
        await autoReviewApplicationWithBrowserOcr(targetApplicationId, snapshot.processingMode);
        if (showSuccess) messageApi.success("Auto review completed.");
      } catch (error) {
        messageApi.error(error instanceof Error ? error.message : "Auto review failed.");
      } finally {
        setReviewingId(null);
      }
    },
    [messageApi, snapshot.processingMode]
  );

  useEffect(() => {
    if (application && !application.review && ["DRAFT", "READY_TO_SUBMIT", "SUBMITTED", "RESUBMITTED", "IN_REVIEW"].includes(application.status)) {
      void runAutoReview(application.id, false);
    }
  }, [application?.id]);

  const goToOffset = (offset: number) => {
    if (activeIndex < 0) return;
    const next = snapshot.applications[activeIndex + offset];
    if (!next) return;
    setActiveApplication(next.id);
    if (!next.review) {
      void runAutoReview(next.id, false);
    }
    navigate(`/reviewer/applications/${next.id}`);
  };

  const runSafely = (action: () => void, success?: string) => {
    try {
      action();
      if (success) messageApi.success(success);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Reviewer action failed.");
    }
  };

  useKeyboardShortcuts(
    useMemo(
      () => ({
        n: () => goToOffset(1),
        p: () => goToOffset(-1),
        r: () => application && void runAutoReview(application.id),
        a: () => application && runSafely(() => acceptAutoReview(application.id), "Automated result accepted."),
        c: () => setCorrectionOpen(true)
      }),
      [activeIndex, application?.id, snapshot.applications, snapshot.processingMode]
    )
  );

  if (!application) return <Alert type="warning" message="No applications are loaded." />;

  return (
    <div className="workbench-grid">
      {contextHolder}
      <section className="workbench-main">
        <ReviewHeader
          application={application}
          mode={snapshot.processingMode}
          onNext={() => goToOffset(1)}
          onPrevious={() => goToOffset(-1)}
          hasNext={hasNext}
          hasPrevious={hasPrevious}
          reviewing={reviewingId === application.id}
          onRun={() => void runAutoReview(application.id)}
        />
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={10}>
            <EvidenceViewer application={application} selectedImage={selectedImage} onSelectImage={setSelectedImageId} />
            <EvidenceCropStrip application={application} />
            <OcrTextPanel application={application} />
          </Col>
          <Col xs={24} xl={14}>
            <FieldReviewTable application={application} />
          </Col>
        </Row>
      </section>
      <aside className="workbench-side">
        <DecisionPanel application={application} onOpenCorrection={() => setCorrectionOpen(true)} onAction={runSafely} />
        <ReviewNotesPanel application={application} />
        <ReviewTimeline application={application} />
      </aside>
      <CorrectionRequestDrawer application={application} open={correctionOpen} onClose={() => setCorrectionOpen(false)} />
    </div>
  );
}

function ReviewHeader({
  application,
  mode,
  hasNext,
  hasPrevious,
  onNext,
  onPrevious,
  onRun,
  reviewing
}: {
  application: ReviewApplication;
  mode: "browser" | "backend" | "cluster";
  hasNext: boolean;
  hasPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onRun: () => void;
  reviewing: boolean;
}) {
  return (
    <Card className="workbench-header" size="small">
      <div className="stack-tight">
        <Space wrap>
          <Typography.Title level={2}>{application.title}</Typography.Title>
          <StatusTag status={application.status} />
          <ModeTag mode={mode} />
        </Space>
        <Typography.Text type="secondary">{application.metadata.description}</Typography.Text>
        <ApplicationProgressTracker status={application.status} />
      </div>
      <Space wrap>
        <Button icon={<ArrowLeftOutlined />} disabled={!hasPrevious} onClick={onPrevious}>
          Previous
        </Button>
        <Button type="primary" icon={<ArrowRightOutlined />} disabled={!hasNext} onClick={onNext}>
          Next Application
        </Button>
        <Button icon={<PlayCircleOutlined />} loading={reviewing} onClick={onRun}>
          Auto Review
        </Button>
        <PdfExportButton application={application} pageName="Reviewer Workbench" />
      </Space>
    </Card>
  );
}

function EvidenceViewer({
  application,
  selectedImage,
  onSelectImage
}: {
  application: ReviewApplication;
  selectedImage?: LabelImage;
  onSelectImage: (imageId: string) => void;
}) {
  return (
    <Space orientation="vertical" className="full-width" size={12}>
      <Card title="Label Images" size="small">
        <Space wrap className="evidence-thumb-strip">
          {application.images.map((image) => (
            <Button
              key={image.id}
              className={selectedImage?.id === image.id ? "selected-thumb-button" : undefined}
              onClick={() => onSelectImage(image.id)}
            >
              <Image src={image.url} alt={`${image.name} thumbnail`} preview={false} width={34} height={34} className="image-thumb" />
              {image.role.replace("_", " ")}
            </Button>
          ))}
        </Space>
      </Card>
      <ImageWorkbench image={selectedImage} />
    </Space>
  );
}

function EvidenceCropStrip({ application }: { application: ReviewApplication }) {
  const evidence = (application.review?.fields || []).flatMap((field) =>
    field.evidence.map((item, index) => ({ ...item, fieldLabel: field.label, id: `${field.id}-${index}` }))
  );

  return (
    <Card title="Evidence Crops" size="small">
      {evidence.length ? (
        <List
          size="small"
          dataSource={evidence}
          renderItem={(item) => (
            <List.Item>
              <Space orientation="vertical" size={1}>
                <Typography.Text strong>{item.fieldLabel}</Typography.Text>
                <Typography.Text>{item.excerpt}</Typography.Text>
                <Typography.Text type="secondary">{Math.round(item.confidence * 100)}% evidence confidence</Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      ) : (
        <Typography.Text type="secondary">No evidence extracted yet.</Typography.Text>
      )}
    </Card>
  );
}

function OcrTextPanel({ application }: { application: ReviewApplication }) {
  return (
    <Card title="OCR Text" size="small">
      {application.review ? (
        <Space orientation="vertical" className="full-width" size={8}>
          {application.review.fields.map((field) => (
            <Typography.Paragraph key={field.id} className="ocr-line">
              <Typography.Text strong>{field.label}: </Typography.Text>
              {field.extracted}
            </Typography.Paragraph>
          ))}
        </Space>
      ) : (
        <Typography.Text type="secondary">Run auto review to populate OCR text.</Typography.Text>
      )}
    </Card>
  );
}

export function FieldReviewTable({ application }: { application: ReviewApplication }) {
  const [messageApi, contextHolder] = message.useMessage();
  const columns: ColumnsType<ReviewField> = [
    {
      title: "Field",
      dataIndex: "label",
      width: 160,
      render: (_, field) => (
        <Space orientation="vertical" size={1}>
          <strong>{field.label}</strong>
          <Typography.Text type="secondary">{field.severity}</Typography.Text>
        </Space>
      )
    },
    {
      title: "Expected",
      dataIndex: "expected",
      ellipsis: true
    },
    {
      title: "Detected Evidence",
      dataIndex: "extracted",
      ellipsis: true,
      render: (_, field) => (
        <Space orientation="vertical" size={2}>
          <span>{field.extracted}</span>
          <Typography.Text type="secondary">{Math.round(field.confidence * 100)}% confidence</Typography.Text>
        </Space>
      )
    },
    {
      title: "Auto Status",
      width: 112,
      render: (_, field) => <StatusTag status={field.status} />
    },
    {
      title: "Reviewer Status",
      width: 244,
      render: (_, field) => (
        <Space orientation="vertical" className="decision-cell">
          <Segmented
            aria-label={`${field.label} decision`}
            value={effectiveFieldStatus(field)}
            onChange={(value) => {
              try {
                updateFieldDecision({
                  applicationId: application.id,
                  fieldId: field.id,
                  status: value as FieldStatus,
                  reason: field.reviewerReason
                });
              } catch (error) {
                messageApi.error(error instanceof Error ? error.message : "Could not update field decision.");
              }
            }}
            options={[
              { label: "Pass", value: "PASS" },
              { label: "Fail", value: "FAIL" },
              { label: "Review", value: "NEEDS_REVIEW" }
            ]}
          />
          <Input.TextArea
            aria-label={`${field.label} reasoning`}
            value={field.reviewerReason ?? ""}
            placeholder={field.reason}
            autoSize={{ minRows: 2, maxRows: 4 }}
            onChange={(event) =>
              updateFieldDecision({
                applicationId: application.id,
                fieldId: field.id,
                reason: event.target.value
              })
            }
          />
        </Space>
      )
    },
    {
      title: "Reason",
      dataIndex: "reason",
      ellipsis: true
    },
    {
      title: "Evidence",
      render: (_, field) => field.evidence.map((item) => item.excerpt).join(" ")
    }
  ];

  return (
    <Card title="Application Match Review" size="small">
      {contextHolder}
      <Table rowKey="id" columns={columns} dataSource={application.review?.fields || []} pagination={false} size="middle" scroll={{ x: 1180 }} />
    </Card>
  );
}

function DecisionPanel({
  application,
  onOpenCorrection,
  onAction
}: {
  application: ReviewApplication;
  onOpenCorrection: () => void;
  onAction: (action: () => void, success?: string) => void;
}) {
  const [note, setNote] = useState(application.metadata.reviewerDecisionNote || "");
  const criticalFailures = unresolvedCriticalFailures(application);

  useEffect(() => {
    setNote(application.metadata.reviewerDecisionNote || "");
  }, [application.id, application.metadata.reviewerDecisionNote]);

  return (
    <Card title="Decision Panel" size="small">
      <Space orientation="vertical" className="full-width" size={12}>
        {criticalFailures.length ? (
          <Alert
            type="error"
            showIcon
            message="Approval blocked"
            description="Resolve critical field failures before approving this application."
          />
        ) : null}
        <Input.TextArea
          aria-label="Reviewer decision note"
          value={note}
          rows={4}
          placeholder="Decision notes, condition language, rejection rationale, or escalation reason."
          onChange={(event) => setNote(event.target.value)}
        />
        <Space wrap>
          <Button icon={<CheckCircleOutlined />} onClick={() => onAction(() => acceptAutoReview(application.id), "Automated result accepted.")}>
            Accept Auto Result
          </Button>
          <Button icon={<SendOutlined />} onClick={onOpenCorrection}>
            Request Correction
          </Button>
          <Button
            icon={<ExclamationCircleOutlined />}
            onClick={() =>
              onAction(
                () => finalizeReviewerDecision({ applicationId: application.id, decision: "conditionally_approve", note }),
                "Application conditionally approved."
              )
            }
          >
            Conditionally Approve
          </Button>
          <Button
            type="primary"
            icon={<CheckCircleOutlined />}
            disabled={criticalFailures.length > 0}
            onClick={() => onAction(() => finalizeReviewerDecision({ applicationId: application.id, decision: "approve", note }), "Application approved.")}
          >
            Approve
          </Button>
          <Button danger icon={<StopOutlined />} onClick={() => onAction(() => finalizeReviewerDecision({ applicationId: application.id, decision: "reject", note }), "Application rejected.")}>
            Reject
          </Button>
          <Button icon={<ToolOutlined />} onClick={() => onAction(() => finalizeReviewerDecision({ applicationId: application.id, decision: "escalate", note }), "Application escalated.")}>
            Escalate
          </Button>
          <PdfExportButton application={application} pageName="Reviewer Decision" />
        </Space>
      </Space>
    </Card>
  );
}

function CorrectionRequestDrawer({ application, open, onClose }: { application: ReviewApplication; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<{ message: string; fields: string[] }>();
  const [messageApi, contextHolder] = message.useMessage();
  const fieldOptions = (application.review?.fields || []).map((field) => ({ value: String(field.fieldKey), label: field.label }));

  return (
    <Drawer title="Request Applicant Correction" open={open} onClose={onClose} width={460}>
      {contextHolder}
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          message: application.metadata.correctionMessage || "",
          fields: application.metadata.correctionFields || unresolvedCriticalFailures(application).map((field) => String(field.fieldKey))
        }}
        onFinish={(values) => {
          try {
            requestApplicantCorrection({ applicationId: application.id, message: values.message, fields: values.fields || [] });
            messageApi.success("Correction request sent.");
            onClose();
          } catch (error) {
            messageApi.error(error instanceof Error ? error.message : "Correction request failed.");
          }
        }}
      >
        <Form.Item label="Correction message" name="message" rules={[{ required: true, message: "Correction requests require a message." }]}>
          <Input.TextArea rows={6} />
        </Form.Item>
        <Form.Item label="Requested fields" name="fields">
          <Select mode="multiple" options={fieldOptions} placeholder="Choose affected fields" />
        </Form.Item>
        <Button type="primary" htmlType="submit" icon={<SendOutlined />}>
          Send Correction Request
        </Button>
      </Form>
    </Drawer>
  );
}

function ReviewNotesPanel({ application }: { application: ReviewApplication }) {
  const [form] = Form.useForm();
  const status = application.review?.reviewerOverallStatus || application.review?.status || "NEEDS_REVIEW";

  useEffect(() => {
    form.setFieldsValue({
      reviewerOverallStatus: status,
      reviewerNotes: application.review?.reviewerNotes || ""
    });
  }, [application.id, application.review?.reviewerNotes, status]);

  return (
    <Card title="Agent Notes" size="small">
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          reviewerOverallStatus: status,
          reviewerNotes: application.review?.reviewerNotes || ""
        }}
        onValuesChange={(_, values) =>
          updateReviewNotes({
            applicationId: application.id,
            reviewerOverallStatus: values.reviewerOverallStatus,
            reviewerNotes: values.reviewerNotes
          })
        }
      >
        <Form.Item label="Final disposition" name="reviewerOverallStatus">
          <Segmented
            options={[
              { label: "Pass", value: "PASS" },
              { label: "Fail", value: "FAIL" },
              { label: "Review", value: "NEEDS_REVIEW" }
            ]}
          />
        </Form.Item>
        <Form.Item label="Notes and reasoning" name="reviewerNotes">
          <Input.TextArea rows={5} placeholder="Record override rationale, evidence caveats, or follow-up needs." />
        </Form.Item>
      </Form>
      <Space orientation="vertical" className="full-width">
        <Typography.Text type="secondary">Review ID: {application.review?.id || "Not processed"}</Typography.Text>
        <Typography.Text type="secondary">Updated: {application.updatedAt}</Typography.Text>
      </Space>
    </Card>
  );
}

function ReviewTimeline({ application }: { application: ReviewApplication }) {
  const { snapshot } = useConsoleStore();
  const events = snapshot.auditEvents.filter((event) => event.metadata?.applicationId === application.id || event.summary.includes(application.id));

  return (
    <Card title="Audit Timeline" size="small">
      <Timeline
        items={(events.length ? events : snapshot.auditEvents.slice(0, 5)).map((event) => ({
          dot: <FileSearchOutlined />,
          children: (
            <Space orientation="vertical" size={1}>
              <Typography.Text strong>{event.action}</Typography.Text>
              <Typography.Text>{event.summary}</Typography.Text>
              <Typography.Text type="secondary">{event.actor} - {new Date(event.createdAt).toLocaleString()}</Typography.Text>
            </Space>
          )
        }))}
      />
    </Card>
  );
}
