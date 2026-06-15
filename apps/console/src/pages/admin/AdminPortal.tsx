import {
  AuditOutlined,
  BarChartOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  ToolOutlined
} from "@ant-design/icons";
import { Button, Card, Col, Descriptions, Empty, Row, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { GovMetricCard } from "../../components/common/GovMetricCard";
import { GovAlert } from "../../components/common/GovAlert";
import { StatusTag } from "../../components/common/StatusTag";
import type { AdminJob, WorkerSnapshot } from "../../domain/application/types";
import { useProcessingMode } from "../../hooks/useProcessingMode";
import { GovPageShell } from "../../layouts/GovPageShell";
import { adminMetrics } from "./adminUtils";
import { useAdminOperations } from "./useAdminOperations";

const adminRoutes = [
  { to: "/admin/users", label: "Users", icon: <TeamOutlined /> },
  { to: "/admin/roles", label: "Roles", icon: <SafetyCertificateOutlined /> },
  { to: "/admin/workers", label: "Workers", icon: <DeploymentUnitOutlined /> },
  { to: "/admin/jobs", label: "Jobs", icon: <FileSearchOutlined /> },
  { to: "/admin/engines", label: "Engines", icon: <ToolOutlined /> },
  { to: "/admin/benchmarks", label: "Benchmarks", icon: <BarChartOutlined /> },
  { to: "/admin/audit", label: "Audit", icon: <AuditOutlined /> },
  { to: "/admin/retention", label: "Retention", icon: <DatabaseOutlined /> },
  { to: "/admin/fixtures", label: "Fixtures", icon: <FolderOpenOutlined /> },
  { to: "/admin/settings", label: "Settings", icon: <SettingOutlined /> }
];

export function AdminPortal() {
  const { snapshot, activeApplication } = useAdminOperations();
  const { health } = useProcessingMode();
  const navigate = useNavigate();
  const metrics = adminMetrics(snapshot);
  const latestBenchmark = snapshot.benchmarkRuns[0];
  const fieldExtractor = snapshot.ocrModelStatus[0];

  return (
    <GovPageShell
      title="Admin Operations"
      eyebrow="Operations"
      description="Monitor local coordinator health, worker heartbeats, job scheduling, benchmarks, audit events, fixtures, and read-only retention policy."
    >
      <Space orientation="vertical" className="full-width" size={16}>
      <GovAlert type="info" title="Operations pages are read-only">
        Admin screens expose health, audit, fixtures, benchmark runs, and policy posture. Destructive controls such as worker disable, job cancel, data purge, and packet deletion are intentionally unavailable in the assessment console.
      </GovAlert>
      {snapshot.processingMode === "browser" ? (
        <GovAlert type="warning" title="Browser fallback active">
          The FastAPI/PaddleOCR backend is not reachable. Review tools remain available locally, and the console will return to the backend path automatically when the coordinator comes online.
        </GovAlert>
      ) : null}
      <Row gutter={[16, 16]}>
        <MetricCard title="Applications today" value={metrics.applicationsToday} icon={<DatabaseOutlined />} />
        <MetricCard title="Needs review" value={metrics.needsReview} icon={<AuditOutlined />} />
        <MetricCard title="Active workers" value={metrics.activeWorkers} icon={<DeploymentUnitOutlined />} />
        <MetricCard title="Queue depth" value={metrics.queueDepth} icon={<FileSearchOutlined />} />
        <MetricCard title="Images per minute" value={metrics.imagesPerMinute} icon={<BarChartOutlined />} />
        <MetricCard title="Failed jobs" value={metrics.failedJobs} icon={<ExclamationCircleOutlined />} danger={metrics.failedJobs > 0} />
        <MetricCard title="Storage used" value={metrics.storageUsedMb} suffix="MB" icon={<DatabaseOutlined />} />
        <MetricCard title="p95 OCR time" value={metrics.p95OcrMs} suffix="ms" icon={<BarChartOutlined />} />
      </Row>

      <SchedulerIntelligencePanel workers={snapshot.workers} jobs={snapshot.jobs} />

      <Card size="small" title="Operations Dashboard">
        <Row gutter={[12, 12]}>
          {adminRoutes.map((route) => (
            <Col xs={12} md={8} xl={6} key={route.to}>
              <Button className="admin-route-button" icon={route.icon} onClick={() => navigate(route.to)}>
                {route.label}
              </Button>
            </Col>
          ))}
        </Row>
      </Card>

      <Card size="small" title="Coordinator Health">
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="Backend">{health.status}</Descriptions.Item>
          <Descriptions.Item label="Message">{health.message}</Descriptions.Item>
          <Descriptions.Item label="Runtime Path">
            <Tag color={snapshot.processingMode === "browser" ? "gold" : "blue"}>
              {snapshot.processingMode === "browser" ? "Browser Fallback" : "Backend Primary"}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Latest Benchmark">
            {latestBenchmark
              ? `${latestBenchmark.imageCount} image${latestBenchmark.imageCount === 1 ? "" : "s"} at ${Math.round(latestBenchmark.imagesPerMinute)} images/min`
              : "No benchmark results"}
          </Descriptions.Item>
          <Descriptions.Item label="Field Extractor">
            <Space>
              <Tag color={fieldExtractor?.status === "unavailable" ? "red" : "green"}>PaddleOCR alignment</Tag>
              <Typography.Text>{fieldExtractor?.mode || "paddleocr-weak-field-alignment"}</Typography.Text>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="Active Packet">
            {activeApplication ? (
              <Space>
                <StatusTag status={activeApplication.status} />
                <Typography.Text>{activeApplication.title}</Typography.Text>
              </Space>
            ) : (
              "None"
            )}
          </Descriptions.Item>
        </Descriptions>
      </Card>
      </Space>
    </GovPageShell>
  );
}

function SchedulerIntelligencePanel({ workers, jobs }: { workers: WorkerSnapshot[]; jobs: AdminJob[] }) {
  const activeWorkers = workers.filter((worker) => ["online", "busy", "calibrating"].includes(worker.status) && !worker.disabled);
  const queued = jobs.filter((job) => ["queued", "retrying"].includes(job.status)).length;
  const running = jobs.filter((job) => ["leased", "running"].includes(job.status)).length;
  const completed = jobs.filter((job) => job.status === "completed").length;
  const failed = jobs.filter((job) => job.status === "failed").length;
  const workerColumns: ColumnsType<WorkerSnapshot> = [
    {
      title: "Worker",
      render: (_, worker) => (
        <Space orientation="vertical" size={1}>
          <Typography.Text strong>{worker.hostname}</Typography.Text>
          <Typography.Text type="secondary">{worker.platform}</Typography.Text>
          <Tag>{workerSourceLabel(worker)}</Tag>
        </Space>
      )
    },
    { title: "Engines", render: (_, worker) => <Space wrap>{workerEngineTags(worker).slice(0, 3).map((engine) => <Tag key={engine}>{engine}</Tag>)}</Space> },
    {
      title: "Load",
      width: 150,
      render: (_, worker) => {
        const percent = worker.maxConcurrency ? Math.round((worker.activeJobs / worker.maxConcurrency) * 100) : 0;
        return (
          <div className="worker-load-cell">
            <div
              aria-label={`${worker.hostname} load ${percent}%`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={percent}
              className={worker.disabled ? "worker-load-meter worker-load-meter-disabled" : "worker-load-meter"}
              role="meter"
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            <Typography.Text type="secondary">{percent}%</Typography.Text>
          </div>
        );
      }
    },
    { title: "Latency", render: (_, worker) => `${worker.latencyMs} ms` },
    { title: "Heartbeat", render: (_, worker) => new Date(worker.lastSeenAt).toLocaleTimeString() }
  ];
  const recentJobs = jobs.slice(0, 5);

  return (
    <Row gutter={[16, 16]} className="admin-intelligence-grid">
      <Col xs={24} xl={14}>
        <Card size="small" title="Worker Scheduler Intelligence">
          {activeWorkers.length ? (
            <Table rowKey="id" dataSource={activeWorkers} columns={workerColumns} pagination={false} size="small" />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No backend workers are registered yet." />
          )}
        </Card>
      </Col>
      <Col xs={24} xl={10}>
        <Card size="small" title="Queue Pipeline">
          <Space orientation="vertical" className="full-width" size={12}>
            <Row gutter={[8, 8]}>
              <PipelineStat label="Queued" value={queued} color="default" />
              <PipelineStat label="Running" value={running} color="blue" />
              <PipelineStat label="Done" value={completed} color="green" />
              <PipelineStat label="Failed" value={failed} color="red" />
            </Row>
            <Space orientation="vertical" className="full-width" size={8}>
              {recentJobs.map((job) => (
                <div key={job.id} className="job-signal-row">
                  <Space>
                    <Tag color={job.status === "failed" ? "red" : job.status === "completed" ? "green" : job.status === "running" ? "blue" : "default"}>{job.status}</Tag>
                    <Typography.Text strong>{job.type}</Typography.Text>
                  </Space>
                  <Typography.Text type="secondary">{job.schedulerReason}</Typography.Text>
                </div>
              ))}
            </Space>
          </Space>
        </Card>
      </Col>
    </Row>
  );
}

function workerSourceLabel(worker: WorkerSnapshot): string {
  if (worker.platform.toLowerCase().includes("chromium")) return "local browser session";
  return "registered backend worker";
}

function workerEngineTags(worker: WorkerSnapshot): string[] {
  const engines = Array.isArray(worker.engines) ? worker.engines : [];
  const capabilities = Array.isArray(worker.capabilities) ? worker.capabilities : [];
  return engines.length ? engines : capabilities;
}

function PipelineStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Col xs={12} sm={6}>
      <div className="pipeline-stat">
        <Tag color={color}>{label}</Tag>
        <Typography.Title level={3}>{value}</Typography.Title>
      </div>
    </Col>
  );
}

function MetricCard({ title, value, suffix, icon, danger = false }: {
  title: string;
  value: number;
  suffix?: string;
  icon: ReactNode;
  danger?: boolean;
}) {
  return (
    <Col xs={24} sm={12} lg={8} xl={6}>
      <GovMetricCard title={title} value={`${value}${suffix ? ` ${suffix}` : ""}`} icon={icon} danger={danger} />
    </Col>
  );
}
