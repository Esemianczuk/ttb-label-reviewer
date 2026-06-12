import {
  BarChartOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
  ToolOutlined
} from "@ant-design/icons";
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
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
  const { snapshot, loading, runAction } = useAdminOperations();
  const [messageApi, contextHolder] = message.useMessage();
  const act = async (workerId: string, action: "recalibrate" | "drain" | "disable" | "enable") => {
    await runAction("admin/worker", { workerId, action });
    messageApi.success(`Worker ${action} requested.`);
  };

  return (
    <AdminPage title="Workers" description="Registered local workers advertise engines, capacity, heartbeat freshness, and operational health.">
      <Space orientation="vertical" className="full-width" size={16}>
        {contextHolder}
        <Row gutter={[16, 16]}>
          {snapshot.workers.map((worker) => (
            <Col xs={24} lg={8} key={worker.id}>
              <WorkerCard worker={worker} loading={loading} onAction={act} />
            </Col>
          ))}
        </Row>
      </Space>
    </AdminPage>
  );
}

function WorkerCard({ worker, loading, onAction }: { worker: WorkerSnapshot; loading: boolean; onAction: (workerId: string, action: "recalibrate" | "drain" | "disable" | "enable") => void }) {
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
        <Space wrap>
          <Button loading={loading} icon={<ReloadOutlined />} onClick={() => onAction(worker.id, "recalibrate")}>Recalibrate</Button>
          <Button loading={loading} icon={<PauseCircleOutlined />} onClick={() => onAction(worker.id, "drain")}>Drain</Button>
          {worker.disabled ? (
            <Button loading={loading} icon={<PlayCircleOutlined />} onClick={() => onAction(worker.id, "enable")}>Enable</Button>
          ) : (
            <Button loading={loading} danger icon={<StopOutlined />} onClick={() => onAction(worker.id, "disable")}>Disable</Button>
          )}
        </Space>
      </Space>
    </Card>
  );
}

function workerSourceLabel(worker: WorkerSnapshot): string {
  if (worker.id === "worker-local-browser" || worker.platform.toLowerCase().includes("chromium")) return "local browser session";
  if (worker.id.startsWith("worker-fastapi") || worker.id.startsWith("worker-mac")) return "demo fixture worker";
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
  const { snapshot, loading, runAction } = useAdminOperations();
  const [messageApi, contextHolder] = message.useMessage();
  const act = async (jobId: string, action: "retry" | "cancel" | "raise_priority") => {
    await runAction("admin/job", { jobId, action });
    messageApi.success(`Job ${action.replace("_", " ")} requested.`);
  };
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
    { title: "Scheduler Reason", dataIndex: "schedulerReason", ellipsis: true },
    {
      title: "Actions",
      fixed: "right",
      width: 240,
      render: (_, job) => (
        <Space>
          <Button loading={loading} onClick={() => act(job.id, "retry")}>Retry</Button>
          <Button loading={loading} onClick={() => act(job.id, "raise_priority")}>Raise</Button>
          <Button loading={loading} danger onClick={() => act(job.id, "cancel")}>Cancel</Button>
        </Space>
      )
    }
  ];
  return (
    <AdminPage title="Job Queue" description="Operational queue for OCR, evidence extraction, validation, and review-result tasks. Scheduler reasons are shown as text.">
      <Card size="small" title="Jobs">
        {contextHolder}
        <Table loading={loading} rowKey="id" dataSource={snapshot.jobs} columns={columns} pagination={{ pageSize: 10 }} scroll={{ x: 1500 }} />
      </Card>
    </AdminPage>
  );
}

export function AdminEnginesPage() {
  const { snapshot, runAction } = useAdminOperations();
  return (
    <AdminPage title="OCR Engine Settings" description="Choose allowed local engines and concurrency for browser, backend, and cluster processing.">
      <SettingsForm
        title="Engine Settings"
        settings={snapshot.adminSettings}
        fields={["preferredOcrEngine", "browserOcrAllowed", "backendCpuOcrAllowed", "gpuOcrAllowed", "distributedWorkersAllowed", "maxConcurrency"]}
        onUpdate={(values) => runAction("admin/settings", values as Record<string, unknown>)}
      />
    </AdminPage>
  );
}

export function AdminSettingsPage() {
  const { snapshot, runAction } = useAdminOperations();
  return (
    <AdminPage title="System Settings" description="Sectioned operational settings for validators, warning strictness, local retention, and report-only storage.">
      <GovAlert type="warning" title="Settings affect the local assessment environment">
        LAN mode, retention deletion, and cluster worker settings should be changed intentionally and verified in the audit log.
      </GovAlert>
      <SettingsForm
        title="System Settings"
        settings={snapshot.adminSettings}
        fields={["validatorThreshold", "warningStrictness", "retentionRawImagesDays", "retentionJobsDays", "keepReportsOnly"]}
        onUpdate={(values) => runAction("admin/settings", values as Record<string, unknown>)}
      />
    </AdminPage>
  );
}

function SettingsForm({ title, settings, fields, onUpdate }: { title: string; settings: AdminSettings; fields: Array<keyof AdminSettings>; onUpdate: (settings: Partial<AdminSettings>) => Promise<void> }) {
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<Partial<AdminSettings>>();
  const [dirty, setDirty] = useState(false);
  return (
    <Card size="small" title={title}>
      {contextHolder}
      {fields.includes("distributedWorkersAllowed") ? (
        <GovAlert type="warning" title="Cluster mode is optional">
          Worker registration requires a join token and persistent worker secret. Browser Only mode remains available without distributed workers.
        </GovAlert>
      ) : null}
      {fields.some((field) => String(field).startsWith("retention")) ? (
        <GovAlert type="warning" title="Retention changes can delete local data">
          Retention controls can purge raw assets, old jobs, and demo packets from the local environment.
        </GovAlert>
      ) : null}
      <Form
        form={form}
        key={fields.map((field) => `${String(field)}:${String(settings[field])}`).join("|")}
        layout="vertical"
        initialValues={settings}
        onValuesChange={() => setDirty(true)}
        onFinish={async (values) => {
          await onUpdate(values);
          setDirty(false);
          messageApi.success("Settings saved.");
        }}
      >
        {dirty ? <GovAlert type="warning" title="Unsaved changes">Review the changed values and press Save Settings to write them to the active provider.</GovAlert> : null}
        <Row gutter={16}>
          {fields.map((key) => (
            <Col xs={24} md={12} xl={8} key={key}>
              <Form.Item label={settingLabel(key)} name={key} valuePropName={typeof settings[key] === "boolean" ? "checked" : "value"}>
                {settingControl(key, settings[key])}
              </Form.Item>
            </Col>
          ))}
        </Row>
        <Space>
          <Button type="primary" htmlType="submit" disabled={!dirty}>
            Save Settings
          </Button>
          <Button
            onClick={() => {
              form.resetFields();
              setDirty(false);
            }}
          >
            Revert
          </Button>
        </Space>
      </Form>
    </Card>
  );
}

function settingControl(key: keyof AdminSettings, value: AdminSettings[keyof AdminSettings]) {
  if (typeof value === "boolean") return <Switch />;
  if (key === "preferredOcrEngine") {
    return <Select options={["browser-fixture", "tesseract", "null-engine", "vision-precheck"].map((engine) => ({ value: engine, label: engine }))} />;
  }
  if (key === "warningStrictness") {
    return <Select options={["lenient", "standard", "strict"].map((level) => ({ value: level, label: level }))} />;
  }
  if (key === "validatorThreshold") return <InputNumber min={0.5} max={0.99} step={0.01} className="full-width" />;
  return <InputNumber min={0} max={365} className="full-width" />;
}

export function AdminBenchmarksPage() {
  const { snapshot, loading, runAction } = useAdminOperations();
  const [messageApi, contextHolder] = message.useMessage();
  const run = async (imageCount: number) => {
    await runAction("admin/benchmark", { imageCount, label: `${imageCount} image admin run`, mode: snapshot.processingMode });
    messageApi.success("Benchmark completed.");
  };
  return (
    <AdminPage title="Benchmarks" description="Run quick local benchmarks and review saved browser, backend, or cluster benchmark JSON results.">
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
  const { snapshot, runAction } = useAdminOperations();
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedApplicationId, setSelectedApplicationId] = useState<string>();
  const [purgeConfirmation, setPurgeConfirmation] = useState("");
  const confirm = async (action: () => Promise<void>, success: string) => {
    await action();
    messageApi.success(success);
  };
  return (
    <AdminPage title="Data Retention" description="Purge raw assets, old jobs, specific packets, or all demo data from the local environment.">
      <Space orientation="vertical" className="full-width" size={16}>
        {contextHolder}
        <GovAlert type="warning" title="Retention deletion is permanent in this local demo">
          Use these controls only when you intend to remove local assets, jobs, or demo packets. Each action is recorded in the audit log.
        </GovAlert>
        <SettingsForm
          title="Retention Defaults"
          settings={snapshot.adminSettings}
          fields={["retentionRawImagesDays", "retentionJobsDays", "keepReportsOnly"]}
          onUpdate={(values) => runAction("admin/settings", values as Record<string, unknown>)}
        />
        <Card size="small" title="Retention Actions">
          <Space orientation="vertical" className="full-width" size={12}>
            <Space wrap>
              <Popconfirm title="Purge raw images?" onConfirm={() => confirm(() => runAction("admin/purge-raw-images"), "Raw images purged.")}>
                <Button danger icon={<DeleteOutlined />}>Purge Raw Images</Button>
              </Popconfirm>
              <Popconfirm title="Purge completed and failed jobs?" onConfirm={() => confirm(() => runAction("admin/purge-old-jobs"), "Old jobs purged.")}>
                <Button danger icon={<DeleteOutlined />}>Purge Old Jobs</Button>
              </Popconfirm>
            </Space>
            <Space wrap>
              <Select
                aria-label="Application packet to delete"
                placeholder="Choose application packet"
                value={selectedApplicationId}
                onChange={setSelectedApplicationId}
                options={snapshot.applications.map((application) => ({ value: application.id, label: `${applicationNumberFor(application)} - ${application.title}` }))}
                style={{ minWidth: 360 }}
              />
              <Popconfirm
                title="Delete selected application packet?"
                onConfirm={() => selectedApplicationId && confirm(() => runAction("admin/delete-packet", { applicationId: selectedApplicationId }), "Application packet deleted.")}
              >
                <Button danger disabled={!selectedApplicationId} icon={<DeleteOutlined />}>Delete Selected Packet</Button>
              </Popconfirm>
            </Space>
            <Space wrap>
              <Input
                aria-label="Type PURGE ALL to enable purge all demo data"
                placeholder="Type PURGE ALL"
                value={purgeConfirmation}
                onChange={(event) => setPurgeConfirmation(event.target.value)}
                style={{ width: 180 }}
              />
              <Popconfirm title="Purge all demo data?" onConfirm={() => confirm(() => runAction("admin/purge-all"), "All demo data purged.")}>
                <Button danger disabled={purgeConfirmation !== "PURGE ALL"} icon={<DeleteOutlined />}>Purge All Demo Data</Button>
              </Popconfirm>
            </Space>
          </Space>
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
