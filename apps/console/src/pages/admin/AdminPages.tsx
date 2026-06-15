import {
  BarChartOutlined,
  DownloadOutlined
} from "@ant-design/icons";
import {
  Button,
  Card,
  Col,
  Empty,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { GovAlert } from "../../components/common/GovAlert";
import { StatusTag } from "../../components/common/StatusTag";
import { applicationNumberFor, applicationNumberFromAudit } from "../../domain/application/applicationNumber";
import type { AdminJob, AdminSettings, AuditEvent, BenchmarkRun, ReviewApplication, WorkerSnapshot } from "../../domain/application/types";
import { GovPageShell } from "../../layouts/GovPageShell";
import { getConsoleIdentities } from "../../providers/auth/authProvider";
import { permissionMatrix } from "../../providers/access/permissionMatrix";
import { downloadCsv, estimatedStorageBytes, jobDuration, settingLabel } from "./adminUtils";
import { useAdminOperations } from "./useAdminOperations";

export function AdminUsersPage() {
  return (
    <AdminPage title="Users" description="Demo identities used for local applicant, reviewer, and administrator access checks.">
      <Card size="small" title="Users">
        <Table
          rowKey="id"
          dataSource={getConsoleIdentities()}
          pagination={false}
          columns={[
            { title: "Name", dataIndex: "name" },
            { title: "Email", dataIndex: "email" },
            { title: "Role", render: (_, identity) => <Tag>{identity.role}</Tag> },
            { title: "Status", render: () => <Tag color="green">active</Tag> }
          ]}
        />
      </Card>
    </AdminPage>
  );
}

export function AdminRolesPage() {
  return (
    <AdminPage title="Role Permissions" description="Access-controlled routes and data operations are denied unless the active role is authorized.">
      <Row gutter={[16, 16]}>
        {Object.entries(permissionMatrix).map(([role, rules]) => (
          <Col xs={24} md={8} key={role}>
            <Card size="small" title={role}>
              {rules.map((rule) => (
                <div key={`${role}-${rule.resource}`} className="permission-row">
                  <Typography.Text strong>{rule.resource}</Typography.Text>
                  <div>{rule.actions.map((action) => <Tag key={action}>{action}</Tag>)}</div>
                </div>
              ))}
            </Card>
          </Col>
        ))}
      </Row>
    </AdminPage>
  );
}

export function AdminWorkersPage() {
  const { snapshot } = useAdminOperations();

  return (
    <AdminPage title="Workers" description="Registered local workers advertise engines, capacity, heartbeat freshness, and operational health.">
      <Space orientation="vertical" className="full-width" size={16}>
        <GovAlert type="info" title="Read-only assessment posture">
          Worker controls are shown as operational state only. The hardened demo does not drain, disable, or mutate workers from the console.
        </GovAlert>
        {snapshot.workers.length ? (
          <Row gutter={[16, 16]}>
            {snapshot.workers.map((worker) => (
              <Col xs={24} lg={8} key={worker.id}>
                <WorkerCard worker={worker} />
              </Col>
            ))}
          </Row>
        ) : (
          <Card size="small">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No backend workers are registered. Start the local PaddleOCR backend runner to see worker health here." />
          </Card>
        )}
      </Space>
    </AdminPage>
  );
}

function WorkerCard({ worker }: { worker: WorkerSnapshot }) {
  const load = worker.maxConcurrency ? Math.round((worker.activeJobs / worker.maxConcurrency) * 100) : 0;
  const sourceLabel = workerSourceLabel(worker);
  return (
    <Card
      size="small"
      title={<Typography.Text className="worker-hostname">{worker.hostname}</Typography.Text>}
      extra={<WorkerHealthTag worker={worker} />}
    >
      <Space orientation="vertical" className="full-width" size={10}>
        <Tag>{sourceLabel}</Tag>
        <Typography.Text type="secondary">{worker.os} / {worker.arch}</Typography.Text>
        <Typography.Text>{worker.cpu} · {worker.ramGb ?? 0} GB RAM</Typography.Text>
        <Typography.Text>{worker.gpu || "No accelerator reported"}</Typography.Text>
        <div className="worker-load-cell">
          <div
            aria-label={`${worker.hostname} active job load ${load}%`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={load}
            className={worker.disabled ? "worker-load-meter worker-load-meter-disabled" : "worker-load-meter"}
            role="meter"
          >
            <span style={{ width: `${load}%` }} />
          </div>
          <Typography.Text type="secondary">{load}% load</Typography.Text>
        </div>
        <Typography.Text>Active jobs: {worker.activeJobs} / {worker.maxConcurrency}</Typography.Text>
        <Typography.Text>Average: {worker.avgMsPerImage || 0} ms/image</Typography.Text>
        <Typography.Text>Last heartbeat: {new Date(worker.lastSeenAt).toLocaleString()}</Typography.Text>
        <Space wrap>{workerEngineTags(worker).map((engine) => <Tag key={engine}>{engine}</Tag>)}</Space>
        <Tag color="blue">observability only</Tag>
      </Space>
    </Card>
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

function WorkerHealthTag({ worker }: { worker: WorkerSnapshot }) {
  const label = worker.status === "online" ? "Healthy" : worker.status === "busy" ? "Healthy" : worker.status === "draining" ? "Draining" : worker.status === "offline" ? "Offline" : "Degraded";
  const color = label === "Healthy" ? "green" : label === "Offline" ? "red" : label === "Draining" ? "orange" : "gold";
  return <Tag color={color}>{label}</Tag>;
}

export function AdminJobsPage() {
  const { snapshot, loading } = useAdminOperations();
  const applicationById = new Map(snapshot.applications.map((application) => [application.id, application]));
  const columns: ColumnsType<AdminJob> = [
    { title: "Job ID", dataIndex: "id", width: 240, ellipsis: true },
    { title: "Application #", render: (_, job) => <Link to={`/reviewer/applications/${job.applicationId}`}>{applicationNumberFor(applicationById.get(job.applicationId))}</Link> },
    { title: "Type", dataIndex: "type" },
    { title: "Status", render: (_, job) => <Tag color={job.status === "failed" ? "red" : job.status === "completed" ? "green" : job.status === "running" ? "blue" : "default"}>{job.status}</Tag> },
    { title: "Priority", dataIndex: "priority" },
    { title: "Worker", dataIndex: "workerId" },
    { title: "Engine", dataIndex: "engine" },
    { title: "Attempts", dataIndex: "attempts" },
    { title: "Created", render: (_, job) => new Date(job.createdAt).toLocaleString() },
    { title: "Duration", render: (_, job) => jobDuration(job) },
    { title: "Scheduler Reason", dataIndex: "schedulerReason", ellipsis: true }
  ];
  return (
    <AdminPage title="Job Queue" description="Operational queue for OCR, evidence extraction, validation, and review-result tasks. Scheduler reasons are shown as text.">
      <Card size="small" title="Jobs">
        {snapshot.jobs.length ? (
          <Table loading={loading} rowKey="id" dataSource={snapshot.jobs} columns={columns} pagination={{ pageSize: 10 }} scroll={{ x: 1260 }} />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No backend jobs are queued. Run a backend automated review to create OCR and validation jobs." />
        )}
      </Card>
    </AdminPage>
  );
}

export function AdminEnginesPage() {
  const { snapshot } = useAdminOperations();
  const fieldExtractor = snapshot.ocrModelStatus[0];
  return (
    <AdminPage title="OCR Engine Policy" description="Inspect the hardened OCR path used by backend review. Browser OCR is retained only as an offline fallback.">
      <Space orientation="vertical" className="full-width" size={16}>
        <RuntimePolicyPanel settings={snapshot.adminSettings} />
        <FieldExtractorStatusPanel status={fieldExtractor} />
      </Space>
    </AdminPage>
  );
}

function RuntimePolicyPanel({ settings }: { settings: AdminSettings }) {
  return (
    <Card size="small" title="Authoritative Runtime Policy">
      <Row gutter={[12, 12]}>
        <Col xs={24} md={8}><ModelMetric label="Primary OCR engine" value="PaddleOCR" /></Col>
        <Col xs={24} md={8}><ModelMetric label="Browser OCR" value="Private emergency path" /></Col>
        <Col xs={24} md={8}><ModelMetric label="Max local concurrency" value={String(settings.maxConcurrency)} /></Col>
      </Row>
      <GovAlert type="info" title="No admin mode switching">
        Reviews use backend PaddleOCR when the coordinator is reachable. If the backend is absent, the console falls back to browser-local OCR automatically.
      </GovAlert>
    </Card>
  );
}

function FieldExtractorStatusPanel({ status }: { status?: { trainedModelLoaded: boolean; status: string; mode: string; modelDir: string | null; message: string; modelCard?: Record<string, unknown> | null; metrics?: Record<string, unknown> | null; failureReport?: Record<string, unknown> | null } }) {
  if (!status) return null;
  return (
    <Card
      size="small"
      title="Backend OCR Field Extraction"
      extra={<Tag color={status.status === "unavailable" ? "red" : "green"}>{status.status}</Tag>}
    >
      <Space orientation="vertical" className="full-width" size={12}>
        <GovAlert type={status.status === "unavailable" ? "warning" : "success"} title="PaddleOCR field alignment is the backend authority">
          Backend workers run full-image PaddleOCR, align expected fields to OCR token boxes for evidence crops, and leave pass/fail authority to deterministic validators.
        </GovAlert>
        <Typography.Text>{status.message}</Typography.Text>
        {typeof status.modelCard?.runtimePolicy === "string" ? <Typography.Text>{status.modelCard.runtimePolicy}</Typography.Text> : null}
        <Row gutter={[12, 12]}>
          <Col xs={24} md={8}><ModelMetric label="OCR engine" value="PaddleOCR" /></Col>
          <Col xs={24} md={8}><ModelMetric label="Extraction policy" value="Field alignment" /></Col>
          <Col xs={24} md={8}><ModelMetric label="Decision authority" value="Validators" /></Col>
        </Row>
      </Space>
    </Card>
  );
}

function ModelMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="pipeline-stat">
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Title level={4}>{value}</Typography.Title>
    </div>
  );
}

export function AdminSettingsPage() {
  const { snapshot } = useAdminOperations();
  return (
    <AdminPage title="System Policy" description="Read-only policy values for validators, warning strictness, local retention, and report-only storage.">
      <GovAlert type="info" title="Assessment console is locked down">
        The demo exposes policy values and RBAC boundaries without allowing settings changes from the admin page.
      </GovAlert>
      <SettingsReadOnlyTable settings={snapshot.adminSettings} />
    </AdminPage>
  );
}

function SettingsReadOnlyTable({ settings }: { settings: AdminSettings }) {
  const rows = (Object.keys(settings) as Array<keyof AdminSettings>).map((key) => ({
    key,
    label: settingLabel(key),
    value: String(settings[key])
  }));
  return (
    <Card size="small" title="Policy Values">
      <Table
        rowKey="key"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: "Policy", dataIndex: "label" },
          { title: "Value", dataIndex: "value" }
        ]}
      />
    </Card>
  );
}

export function AdminBenchmarksPage() {
  const { snapshot, loading, runAction } = useAdminOperations();
  const [messageApi, contextHolder] = message.useMessage();
  const run = async (imageCount: number) => {
    await runAction("admin/benchmark", { imageCount, label: `${imageCount} image admin run`, mode: snapshot.processingMode });
    messageApi.success("Benchmark completed.");
  };
  return (
    <AdminPage title="Benchmarks" description="Run quick local benchmarks and review saved browser or backend benchmark JSON results.">
      <Space orientation="vertical" className="full-width" size={16}>
        {contextHolder}
        <Card size="small" title="Run Benchmarks">
          <Space wrap>
            {[1, 10, 50].map((count) => (
              <Button key={count} loading={loading} icon={<BarChartOutlined />} onClick={() => run(count)}>
                {count} image run
              </Button>
            ))}
          </Space>
        </Card>
        <BenchmarkTable runs={snapshot.benchmarkRuns} />
      </Space>
    </AdminPage>
  );
}

function BenchmarkTable({ runs }: { runs: BenchmarkRun[] }) {
  return (
    <Card size="small" title="Benchmark Results">
      <Table
        rowKey="id"
        dataSource={runs}
        pagination={{ pageSize: 8 }}
        columns={[
          { title: "Run", dataIndex: "label" },
          { title: "Status", render: (_, run) => <Tag color={run.status === "skipped" ? "warning" : run.failures ? "error" : "success"}>{run.status || "completed"}</Tag> },
          { title: "Images", dataIndex: "imageCount" },
          { title: "Mode", dataIndex: "mode" },
          { title: "Worker", render: (_, run) => run.workerChosen || run.workerId },
          { title: "Engine", dataIndex: "engineUsed" },
          { title: "Total ms", render: (_, run) => metricValue(run.totalMs) },
          { title: "Avg ms/image", dataIndex: "averageMsPerImage" },
          { title: "p95 ms/image", render: (_, run) => metricValue(run.p95MsPerImage) },
          { title: "Queue ms", render: (_, run) => metricValue(run.queueMs) },
          { title: "Validation ms", render: (_, run) => metricValue(run.validationMs) },
          { title: "p50 OCR", dataIndex: "p50OcrMs" },
          { title: "p95 OCR", dataIndex: "p95OcrMs" },
          { title: "Images/min", dataIndex: "imagesPerMinute" },
          { title: "Failures", render: (_, run) => run.failures || 0 },
          { title: "Created", render: (_, run) => new Date(run.createdAt).toLocaleString() }
        ]}
      />
    </Card>
  );
}

function metricValue(value?: number): string {
  return typeof value === "number" ? String(Math.round(value)) : "0";
}

export function AdminAuditPage() {
  const { snapshot, loading } = useAdminOperations();
  const [actor, setActor] = useState<string>();
  const [role, setRole] = useState<string>();
  const [event, setEvent] = useState<string>();
  const [entity, setEntity] = useState<string>();
  const [application, setApplication] = useState<string>();
  const rows = useMemo(
    () =>
      snapshot.auditEvents.filter((row) =>
        (!actor || row.actor === actor) &&
        (!role || row.role === role) &&
        (!event || row.action === event) &&
        (!entity || row.resource === entity) &&
        (!application || row.metadata?.applicationId === application || row.metadata?.applicationNumber === application || applicationNumberFromAudit(row, snapshot.applications) === application || row.summary.includes(application))
      ),
    [actor, application, entity, event, role, snapshot.auditEvents, snapshot.applications]
  );

  return (
    <AdminPage title="Audit Log" description="Review permission checks, transitions, overrides, worker events, and retention actions with actor and entity context.">
      <Space orientation="vertical" className="full-width" size={16}>
        <Card size="small" title="Audit Filters">
          <Space wrap>
            <Select aria-label="Filter audit events by actor" allowClear placeholder="Actor" value={actor} onChange={setActor} options={uniqueOptions(snapshot.auditEvents.map((row) => row.actor))} style={{ minWidth: 180 }} />
            <Select aria-label="Filter audit events by role" allowClear placeholder="Role" value={role} onChange={setRole} options={uniqueOptions(snapshot.auditEvents.map((row) => row.role))} style={{ minWidth: 150 }} />
            <Select aria-label="Filter audit events by event" allowClear placeholder="Event" value={event} onChange={setEvent} options={uniqueOptions(snapshot.auditEvents.map((row) => row.action))} style={{ minWidth: 220 }} />
            <Select aria-label="Filter audit events by entity" allowClear placeholder="Entity" value={entity} onChange={setEntity} options={uniqueOptions(snapshot.auditEvents.map((row) => row.resource))} style={{ minWidth: 180 }} />
            <Select aria-label="Filter audit events by application" allowClear placeholder="Application" value={application} onChange={setApplication} options={snapshot.applications.map((app) => ({ value: applicationNumberFor(app), label: `${applicationNumberFor(app)} - ${app.title}` }))} style={{ minWidth: 260 }} />
            <Button icon={<DownloadOutlined />} onClick={() => downloadCsv("ttb-audit-events.csv", rows)}>Export CSV</Button>
          </Space>
        </Card>
        <AuditTable rows={rows} applications={snapshot.applications} loading={loading} />
      </Space>
    </AdminPage>
  );
}

function AuditTable({ rows, applications, loading }: { rows: AuditEvent[]; applications: ReviewApplication[]; loading: boolean }) {
  return (
    <Card size="small" title="Audit Events">
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 10 }}
        expandable={{
          expandedRowRender: (row) => <pre className="json-diff">{JSON.stringify(row.metadata || {}, null, 2)}</pre>
        }}
        columns={[
          { title: "Time", render: (_, row) => new Date(row.createdAt).toLocaleString(), width: 210 },
          { title: "Actor", dataIndex: "actor" },
          { title: "Role", dataIndex: "role" },
          { title: "Application #", render: (_, row) => applicationNumberFromAudit(row, applications) || "System" },
          { title: "Event", dataIndex: "action" },
          { title: "Entity", dataIndex: "resource" },
          { title: "Summary", dataIndex: "summary" }
        ]}
      />
    </Card>
  );
}

export function AdminRetentionPage() {
  const { snapshot } = useAdminOperations();
  return (
    <AdminPage title="Data Retention" description="Inspect local retention posture without destructive admin actions.">
      <Space orientation="vertical" className="full-width" size={16}>
        <GovAlert type="info" title="Retention actions are disabled in the assessment console">
          The backend still demonstrates audited retention endpoints for RBAC tests, but this admin page is read-only to prevent accidental data loss during review.
        </GovAlert>
        <Card size="small" title="Retention Defaults">
          <Row gutter={[12, 12]}>
            <Col xs={24} md={8}><ModelMetric label="Raw image retention" value={`${snapshot.adminSettings.retentionRawImagesDays} days`} /></Col>
            <Col xs={24} md={8}><ModelMetric label="Job retention" value={`${snapshot.adminSettings.retentionJobsDays} days`} /></Col>
            <Col xs={24} md={8}><ModelMetric label="Reports only" value={snapshot.adminSettings.keepReportsOnly ? "enabled" : "disabled"} /></Col>
          </Row>
        </Card>
        <Card size="small" title="Storage">
          <Typography.Text>{(estimatedStorageBytes(snapshot) / 1024 / 1024).toFixed(1)} MB estimated raw image storage.</Typography.Text>
        </Card>
      </Space>
    </AdminPage>
  );
}

export function AdminFixturesPage() {
  const { snapshot } = useAdminOperations();
  const columns: ColumnsType<ReviewApplication> = [
    { title: "Application #", render: (_, application) => applicationNumberFor(application) },
    { title: "Fixture", render: (_, application) => application.metadata.fixtureId || application.id },
    { title: "Brand", render: (_, application) => application.expectedFields.brandName },
    { title: "Images", render: (_, application) => application.images.length },
    { title: "Expected", render: (_, application) => application.expectedOutcome },
    { title: "Status", render: (_, application) => <StatusTag status={application.status} /> },
    { title: "Path", render: (_, application) => application.metadata.packetPath || application.metadata.publicRegistryUrl || "upload" }
  ];
  return (
    <AdminPage title="Fixture Registry" description="Review the sample packets used by the local assessment demo.">
      <Card size="small" title="Fixture Registry">
        <Table rowKey="id" dataSource={snapshot.applications} columns={columns} pagination={{ pageSize: 10 }} scroll={{ x: 920 }} />
      </Card>
    </AdminPage>
  );
}

function uniqueOptions(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter(Boolean))).map((value) => ({ value: value as string, label: value as string }));
}

function AdminPage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <GovPageShell title={title} eyebrow="Operations" description={description}>
      {children}
    </GovPageShell>
  );
}
