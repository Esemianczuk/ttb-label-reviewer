import { AuditOutlined, CheckCircleOutlined, CloudServerOutlined, FileSearchOutlined, FormOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Button, Card, Col, Row, Space, Tag, Typography } from "antd";
import { Navigate, useNavigate } from "react-router";
import type { UserRole } from "../../domain/application/types";
import { StatusTag } from "../../components/common/StatusTag";
import { GovAlert } from "../../components/common/GovAlert";
import { GovMetricCard } from "../../components/common/GovMetricCard";
import { GovPageShell } from "../../layouts/GovPageShell";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { ROLE_STORAGE_KEY, getStoredRole, roleHomePath, setStoredRole } from "../../providers/auth/authProvider";
import { lowConfidenceFields, unresolvedCriticalFailures } from "../reviewer/reviewerUtils";

export function RoleLanding() {
  const navigate = useNavigate();
  const { snapshot } = useConsoleStore();
  const stored = window.localStorage.getItem(ROLE_STORAGE_KEY);
  if (stored === "reviewer" || stored === "applicant" || stored === "admin") {
    return <Navigate to={roleHomePath(getStoredRole())} replace />;
  }

  const continueAs = (role: UserRole) => {
    setStoredRole(role);
    navigate(roleHomePath(role));
  };

  const activeQueue = snapshot.applications.filter((application) => !["ARCHIVED", "WITHDRAWN"].includes(application.status));
  const critical = activeQueue.filter((application) => unresolvedCriticalFailures(application).length > 0).length;
  const lowConfidence = activeQueue.filter((application) => lowConfidenceFields(application).length > 0).length;
  const firstApplication = activeQueue[0];

  return (
    <GovPageShell
      title="TTB Label Reviewer"
      eyebrow="Demo review console"
      description="Evidence-first COLA label review with deterministic validation, local OCR evidence, auditable reviewer decisions, and optional backend workers."
      primaryAction={
        <Button type="primary" size="large" icon={<FileSearchOutlined />} onClick={() => continueAs("reviewer")}>
          Continue as Reviewer
        </Button>
      }
      secondaryActions={
        <>
          <Button size="large" icon={<FormOutlined />} onClick={() => continueAs("applicant")}>
            Continue as Applicant
          </Button>
          <Button size="large" icon={<AuditOutlined />} onClick={() => continueAs("admin")}>
            Continue as Admin
          </Button>
        </>
      }
    >
      <Space orientation="vertical" className="full-width role-entry" size={16}>
      <section className="role-entry-hero">
        <div className="stack-tight">
          <Space wrap>
            <Tag color="green">Browser Only ready</Tag>
            <Tag color="blue">Backend optional</Tag>
            <Tag color="purple">Cluster capable</Tag>
          </Space>
          <Typography.Title level={2}>Reviewer dashboard first</Typography.Title>
          <Typography.Paragraph>
            Open the queue, process the first sample immediately, inspect the label image, compare application fields against OCR evidence, and record the reviewer decision.
            </Typography.Paragraph>
          <Space wrap>
            <Button type="primary" size="large" icon={<FileSearchOutlined />} onClick={() => continueAs("reviewer")}>
              Open Reviewer Queue
            </Button>
            <Button size="large" icon={<FormOutlined />} onClick={() => continueAs("applicant")}>
              Start Applicant Packet
            </Button>
            <Button size="large" icon={<AuditOutlined />} onClick={() => continueAs("admin")}>
              Open Operations Dashboard
            </Button>
          </Space>
        </div>
        <Card size="small" className="role-entry-active">
          <Space orientation="vertical" className="full-width" size={12}>
            <Space wrap>
              <SafetyCertificateOutlined />
              <Typography.Text strong>Active review packet</Typography.Text>
              {firstApplication ? <StatusTag status={firstApplication.status} /> : null}
            </Space>
            <Typography.Title level={3}>{firstApplication?.title || "No packet loaded"}</Typography.Title>
            <Typography.Text type="secondary">{firstApplication?.metadata.description || "Demo queue is ready."}</Typography.Text>
            <Row gutter={[10, 10]}>
              <Col span={8}>
                <GovMetricCard title="Queue" value={activeQueue.length} summary="active packets" />
              </Col>
              <Col span={8}>
                <GovMetricCard title="Critical" value={critical} summary="unresolved" danger={critical > 0} />
              </Col>
              <Col span={8}>
                <GovMetricCard title="Low confidence" value={lowConfidence} summary="needs review" />
              </Col>
            </Row>
          </Space>
        </Card>
      </section>
      <GovAlert type="info" title="Demo note">
        This demo is not an official TTB system. OCR output is evidence, not the final decision; a reviewer must confirm or override unresolved issues.
      </GovAlert>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card size="small" title="Reviewer">
            <Space orientation="vertical" className="full-width">
              <Typography.Text>Open the queue, process the first sample immediately, inspect evidence, adjust decisions, and export PDF packets.</Typography.Text>
              <Button type="primary" icon={<FileSearchOutlined />} onClick={() => continueAs("reviewer")}>
                Open Reviewer Workspace
              </Button>
            </Space>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" title="Applicant">
            <Space orientation="vertical" className="full-width">
              <Typography.Text>Create an application packet, upload label evidence, submit it for review, and resubmit updates when a reviewer requests changes.</Typography.Text>
              <Button icon={<FormOutlined />} onClick={() => continueAs("applicant")}>
                Open Applicant Workspace
              </Button>
            </Space>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" title="Admin">
            <Space orientation="vertical" className="full-width">
              <Typography.Text>Inspect workers, job leases, benchmarks, audit events, retention controls, fixtures, and backend health.</Typography.Text>
              <Button icon={<AuditOutlined />} onClick={() => continueAs("admin")}>
                Open Admin Workspace
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>
      <Card size="small" className="mode-proof">
        <Row gutter={[12, 12]}>
          <Col xs={24} md={8}>
            <Space>
              <CheckCircleOutlined className="status-pass" />
              <Typography.Text>Browser OCR and validators run locally.</Typography.Text>
            </Space>
          </Col>
          <Col xs={24} md={8}>
            <Space>
              <CloudServerOutlined />
              <Typography.Text>FastAPI backend can be turned on when needed.</Typography.Text>
            </Space>
          </Col>
          <Col xs={24} md={8}>
            <Space>
              <AuditOutlined />
              <Typography.Text>Every override and transition is audit-visible.</Typography.Text>
            </Space>
          </Col>
        </Row>
      </Card>
      </Space>
    </GovPageShell>
  );
}
