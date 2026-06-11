import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  PlayCircleOutlined,
  StopOutlined
} from "@ant-design/icons";
import { Alert, Button, Card, Col, Form, Input, Radio, Row, Segmented, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo } from "react";
import type { FieldStatus, ReviewApplication, ReviewField } from "../../domain/application/types";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import {
  autoReviewApplication,
  queueApplication,
  setActiveApplication,
  updateFieldDecision,
  updateReviewNotes
} from "../../providers/data/browserStore";
import { ImageWorkbench } from "../common/ImageWorkbench";
import { PdfExportButton } from "../common/PdfExportButton";
import { ModeTag, StatusTag } from "../common/StatusTag";

export function ReviewWorkbench() {
  const { snapshot, activeApplication, activeIndex, hasNext, hasPrevious } = useConsoleStore();
  const application = activeApplication;

  useEffect(() => {
    if (application && !application.review && ["draft", "queued"].includes(application.status)) {
      queueApplication(application.id);
      autoReviewApplication(application.id, snapshot.processingMode);
    }
  }, [application?.id]);

  const goToOffset = (offset: number) => {
    if (activeIndex < 0) return;
    const next = snapshot.applications[activeIndex + offset];
    if (!next) return;
    setActiveApplication(next.id);
    if (!next.review) {
      queueApplication(next.id);
      autoReviewApplication(next.id, snapshot.processingMode);
    }
  };

  useKeyboardShortcuts(
    useMemo(
      () => ({
        n: () => goToOffset(1),
        p: () => goToOffset(-1)
      }),
      [activeIndex, snapshot.applications, snapshot.processingMode]
    )
  );

  if (!application) return <Alert type="warning" message="No applications are loaded." />;

  return (
    <div className="workbench-grid">
      <section className="workbench-main">
        <ReviewHeader application={application} mode={snapshot.processingMode} onNext={() => goToOffset(1)} onPrevious={() => goToOffset(-1)} hasNext={hasNext} hasPrevious={hasPrevious} />
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={10}>
            <ImageWorkbench image={application.images[0]} />
          </Col>
          <Col xs={24} xl={14}>
            <FieldDecisionTable application={application} />
          </Col>
        </Row>
      </section>
      <aside className="workbench-side">
        <ReviewNotesPanel application={application} />
        <Card title="Processing Trace" size="small">
          <ul className="trace-list">
            {(application.review?.engineTrace || ["Queued for first review"]).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      </aside>
    </div>
  );
}

function ReviewHeader({
  application,
  mode,
  hasNext,
  hasPrevious,
  onNext,
  onPrevious
}: {
  application: ReviewApplication;
  mode: "browser" | "backend" | "cluster";
  hasNext: boolean;
  hasPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
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
      </div>
      <Space wrap>
        <Button icon={<ArrowLeftOutlined />} disabled={!hasPrevious} onClick={onPrevious}>
          Previous
        </Button>
        <Button
          type="primary"
          icon={application.review ? <ArrowRightOutlined /> : <PlayCircleOutlined />}
          disabled={!hasNext}
          onClick={onNext}
        >
          Next Application
        </Button>
        <Button icon={<PlayCircleOutlined />} onClick={() => autoReviewApplication(application.id, mode)}>
          Auto Review
        </Button>
        <PdfExportButton application={application} pageName="Reviewer Workbench" />
      </Space>
    </Card>
  );
}

function FieldDecisionTable({ application }: { application: ReviewApplication }) {
  const columns: ColumnsType<ReviewField> = [
    {
      title: "Field",
      dataIndex: "label",
      width: 166,
      render: (_, field) => (
        <Space orientation="vertical" size={1}>
          <strong>{field.label}</strong>
          <StatusTag status={field.reviewerStatus || field.status} />
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
      title: "Decision",
      width: 230,
      render: (_, field) => (
        <Space orientation="vertical" className="decision-cell">
          <Segmented
            aria-label={`${field.label} decision`}
            value={field.reviewerStatus || field.status}
            onChange={(value) =>
              updateFieldDecision({
                applicationId: application.id,
                fieldId: field.id,
                status: value as FieldStatus
              })
            }
            options={[
              { label: "Pass", value: "pass" },
              { label: "Fail", value: "fail" },
              { label: "Review", value: "needs_review" }
            ]}
          />
          <Input.TextArea
            aria-label={`${field.label} reasoning`}
            value={field.reviewerReason ?? field.reason}
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
    }
  ];

  return (
    <Card title="Application Match Review" size="small">
      <Table rowKey="id" columns={columns} dataSource={application.review?.fields || []} pagination={false} size="middle" scroll={{ x: 860 }} />
    </Card>
  );
}

function ReviewNotesPanel({ application }: { application: ReviewApplication }) {
  const [form] = Form.useForm();
  const status = application.review?.reviewerOverallStatus || application.status;

  return (
    <Card title="Agent Decision" size="small">
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
          <Radio.Group buttonStyle="solid">
            <Radio.Button value="pass">
              <CheckCircleOutlined /> Pass
            </Radio.Button>
            <Radio.Button value="fail">
              <StopOutlined /> Fail
            </Radio.Button>
            <Radio.Button value="needs_review">Needs Review</Radio.Button>
          </Radio.Group>
        </Form.Item>
        <Form.Item label="Notes and reasoning" name="reviewerNotes">
          <Input.TextArea rows={8} placeholder="Record override rationale, evidence caveats, or follow-up needs." />
        </Form.Item>
      </Form>
      <Space orientation="vertical" className="full-width">
        <Typography.Text type="secondary">Review ID: {application.review?.id || "Not processed"}</Typography.Text>
        <Typography.Text type="secondary">Updated: {application.updatedAt}</Typography.Text>
      </Space>
    </Card>
  );
}
