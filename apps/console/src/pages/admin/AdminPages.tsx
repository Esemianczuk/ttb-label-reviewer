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
  Progress,
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
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { StatusTag } from "../../components/common/StatusTag";
import type { AdminJob, AdminSettings, AuditEvent, BenchmarkRun, ReviewApplication, WorkerSnapshot } from "../../domain/application/types";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { getConsoleIdentities } from "../../providers/auth/authProvider";
import { permissionMatrix } from "../../providers/access/permissionMatrix";
import {
  deleteApplicationPacket,
  purgeAllDemoData,
  purgeOldJobs,
  purgeRawImages,
  runAdminBenchmark,
  updateAdminSettings,
  updateJobOperation,
  updateWorkerOperation
} from "../../providers/data/browserStore";
import { adminMetrics, downloadCsv, estimatedStorageBytes, jobDuration, settingLabel } from "./adminUtils";

export function AdminUsersPage() {
  return (
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
  );
}

export function AdminRolesPage() {
  return (
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
  );
}

export function AdminWorkersPage() {
  const { snapshot } = useConsoleStore();
  const [messageApi, contextHolder] = message.useMessage();
  const act = (workerId: string, action: "recalibrate" | "drain" | "disable" | "enable") => {
    updateWorkerOperation({ workerId, action });
    messageApi.success(`Worker ${action} requested.`);
  };

  return (
    <Space orientation="vertical" className="full-width" size={16}>
      {contextHolder}
      <Row gutter={[16, 16]}>
        {snapshot.workers.map((worker) => (
          <Col xs={24} lg={8} key={worker.id}>
            <WorkerCard worker={worker} onAction={act} />
          </Col>
        ))}
      </Row>
    </Space>
  );
}

function WorkerCard({ worker, onAction }: { worker: WorkerSnapshot; onAction: (workerId: string, action: "recalibrate" | "drain" | "disable" | "enable") => void }) {
  const load = worker.maxConcurrency ? Math.round((worker.activeJobs / worker.maxConcurrency) * 100) : 0;
  return (
    <Card
      size="small"
      title={worker.hostname}
      extra={<Tag color={worker.status === "online" ? "green" : worker.status === "busy" ? "blue" : worker.status === "offline" ? "red" : "orange"}>{worker.status}</Tag>}
    >
      <Space orientation="vertical" className="full-width" size={10}>
        <Typography.Text type="secondary">{worker.os} / {worker.arch}</Typography.Text>
        <Typography.Text>{worker.cpu} · {worker.ramGb ?? 0} GB RAM</Typography.Text>
        <Typography.Text>{worker.gpu || "No accelerator reported"}</Typography.Text>
        <Progress percent={load} size="small" />
        <Typography.Text>Active jobs: {worker.activeJobs} / {worker.maxConcurrency}</Typography.Text>
        <Typography.Text>Average: {worker.avgMsPerImage || 0} ms/image</Typography.Text>
        <Typography.Text>Last heartbeat: {new Date(worker.lastSeenAt).toLocaleString()}</Typography.Text>
        <Space wrap>{(worker.engines || worker.capabilities).map((engine) => <Tag key={engine}>{engine}</Tag>)}</Space>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => onAction(worker.id, "recalibrate")}>Recalibrate</Button>
          <Button icon={<PauseCircleOutlined />} onClick={() => onAction(worker.id, "drain")}>Drain</Button>
          {worker.disabled ? (
            <Button icon={<PlayCircleOutlined />} onClick={() => onAction(worker.id, "enable")}>Enable</Button>
          ) : (
            <Button danger icon={<StopOutlined />} onClick={() => onAction(worker.id, "disable")}>Disable</Button>
          )}
        </Space>
      </Space>
    </Card>
  );
}

export function AdminJobsPage() {
  const { snapshot } = useConsoleStore();
  const [messageApi, contextHolder] = message.useMessage();
  const act = (jobId: string, action: "retry" | "cancel" | "raise_priority") => {
    updateJobOperation({ jobId, action });
    messageApi.success(`Job ${action.replace("_", " ")} requested.`);
  };
  const columns: ColumnsType<AdminJob> = [
    { title: "Job ID", dataIndex: "id", width: 240, ellipsis: true },
    { title: "Application", render: (_, job) => <Link to={`/reviewer/applications/${job.applicationId}`}>{job.applicationId}</Link> },
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
          <Button onClick={() => act(job.id, "retry")}>Retry</Button>
          <Button onClick={() => act(job.id, "raise_priority")}>Raise</Button>
          <Button danger onClick={() => act(job.id, "cancel")}>Cancel</Button>
        </Space>
      )
    }
  ];
  return (
    <Card size="small" title="Jobs">
      {contextHolder}
      <Table rowKey="id" dataSource={snapshot.jobs} columns={columns} pagination={{ pageSize: 10 }} scroll={{ x: 1500 }} />
    </Card>
  );
}

export function AdminEnginesPage() {
  const { snapshot } = useConsoleStore();
  return (
    <SettingsForm
      title="Engine Settings"
      settings={snapshot.adminSettings}
      fields={["preferredOcrEngine", "browserOcrAllowed", "backendCpuOcrAllowed", "gpuOcrAllowed", "distributedWorkersAllowed", "maxConcurrency"]}
    />
  );
}

export function AdminSettingsPage() {
  const { snapshot } = useConsoleStore();
  return (
    <SettingsForm
      title="System Settings"
      settings={snapshot.adminSettings}
      fields={["validatorThreshold", "warningStrictness", "retentionRawImagesDays", "retentionJobsDays", "keepReportsOnly"]}
    />
  );
}

function SettingsForm({ title, settings, fields }: { title: string; settings: AdminSettings; fields: Array<keyof AdminSettings> }) {
  const [messageApi, contextHolder] = message.useMessage();
  return (
    <Card size="small" title={title}>
      {contextHolder}
      <Form
        layout="vertical"
        initialValues={settings}
        onValuesChange={(_, values) => {
          updateAdminSettings(values);
          messageApi.success("Settings saved.");
        }}
      >
        <Row gutter={16}>
          {fields.map((key) => (
            <Col xs={24} md={12} xl={8} key={key}>
              <Form.Item label={settingLabel(key)} name={key} valuePropName={typeof settings[key] === "boolean" ? "checked" : "value"}>
                {settingControl(key, settings[key])}
              </Form.Item>
            </Col>
          ))}
        </Row>
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
  const { snapshot } = useConsoleStore();
  const [messageApi, contextHolder] = message.useMessage();
  const run = (imageCount: number) => {
    runAdminBenchmark({ imageCount, label: `${imageCount} image admin run`, mode: snapshot.processingMode });
    messageApi.success("Benchmark completed.");
  };
  return (
    <Space orientation="vertical" className="full-width" size={16}>
      {contextHolder}
      <Card size="small" title="Run Benchmarks">
        <Space wrap>
          {[1, 10, 50].map((count) => (
            <Button key={count} icon={<BarChartOutlined />} onClick={() => run(count)}>
              {count} image run
            </Button>
          ))}
        </Space>
      </Card>
      <BenchmarkTable runs={snapshot.benchmarkRuns} />
    </Space>
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
          { title: "Images", dataIndex: "imageCount" },
          { title: "Mode", dataIndex: "mode" },
          { title: "Worker", dataIndex: "workerId" },
          { title: "Avg ms/image", dataIndex: "averageMsPerImage" },
          { title: "p50 OCR", dataIndex: "p50OcrMs" },
          { title: "p95 OCR", dataIndex: "p95OcrMs" },
          { title: "Images/min", dataIndex: "imagesPerMinute" },
          { title: "Created", render: (_, run) => new Date(run.createdAt).toLocaleString() }
        ]}
      />
    </Card>
  );
}

export function AdminAuditPage() {
  const { snapshot } = useConsoleStore();
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
        (!application || row.metadata?.applicationId === application || row.summary.includes(application))
      ),
    [actor, application, entity, event, role, snapshot.auditEvents]
  );

  return (
    <Space orientation="vertical" className="full-width" size={16}>
      <Card size="small" title="Audit Filters">
        <Space wrap>
          <Select allowClear placeholder="Actor" value={actor} onChange={setActor} options={uniqueOptions(snapshot.auditEvents.map((row) => row.actor))} style={{ minWidth: 180 }} />
          <Select allowClear placeholder="Role" value={role} onChange={setRole} options={uniqueOptions(snapshot.auditEvents.map((row) => row.role))} style={{ minWidth: 150 }} />
          <Select allowClear placeholder="Event" value={event} onChange={setEvent} options={uniqueOptions(snapshot.auditEvents.map((row) => row.action))} style={{ minWidth: 220 }} />
          <Select allowClear placeholder="Entity" value={entity} onChange={setEntity} options={uniqueOptions(snapshot.auditEvents.map((row) => row.resource))} style={{ minWidth: 180 }} />
          <Select allowClear placeholder="Application" value={application} onChange={setApplication} options={snapshot.applications.map((app) => ({ value: app.id, label: app.expectedFields.applicationId || app.id }))} style={{ minWidth: 220 }} />
          <Button icon={<DownloadOutlined />} onClick={() => downloadCsv("ttb-audit-events.csv", rows)}>Export CSV</Button>
        </Space>
      </Card>
      <AuditTable rows={rows} />
    </Space>
  );
}

function AuditTable({ rows }: { rows: AuditEvent[] }) {
  return (
    <Card size="small" title="Audit Events">
      <Table
        rowKey="id"
        dataSource={rows}
        pagination={{ pageSize: 10 }}
        expandable={{
          expandedRowRender: (row) => <pre className="json-diff">{JSON.stringify(row.metadata || {}, null, 2)}</pre>
        }}
        columns={[
          { title: "Time", render: (_, row) => new Date(row.createdAt).toLocaleString(), width: 210 },
          { title: "Actor", dataIndex: "actor" },
          { title: "Role", dataIndex: "role" },
          { title: "Event", dataIndex: "action" },
          { title: "Entity", dataIndex: "resource" },
          { title: "Summary", dataIndex: "summary" }
        ]}
      />
    </Card>
  );
}

export function AdminRetentionPage() {
  const { snapshot } = useConsoleStore();
  const [messageApi, contextHolder] = message.useMessage();
  const firstApplication = snapshot.applications[0];
  const confirm = (action: () => void, success: string) => {
    action();
    messageApi.success(success);
  };
  return (
    <Space orientation="vertical" className="full-width" size={16}>
      {contextHolder}
      <SettingsForm
        title="Retention Defaults"
        settings={snapshot.adminSettings}
        fields={["retentionRawImagesDays", "retentionJobsDays", "keepReportsOnly"]}
      />
      <Card size="small" title="Retention Actions">
        <Space wrap>
          <Popconfirm title="Purge raw images?" onConfirm={() => confirm(purgeRawImages, "Raw images purged.")}>
            <Button danger icon={<DeleteOutlined />}>Purge Raw Images</Button>
          </Popconfirm>
          <Popconfirm title="Purge completed and failed jobs?" onConfirm={() => confirm(purgeOldJobs, "Old jobs purged.")}>
            <Button danger icon={<DeleteOutlined />}>Purge Old Jobs</Button>
          </Popconfirm>
          <Popconfirm title={`Delete ${firstApplication?.title || "selected packet"}?`} onConfirm={() => firstApplication && confirm(() => deleteApplicationPacket(firstApplication.id), "Application packet deleted.")}>
            <Button danger disabled={!firstApplication} icon={<DeleteOutlined />}>Delete Application Packet</Button>
          </Popconfirm>
          <Popconfirm title="Purge all demo data?" onConfirm={() => confirm(purgeAllDemoData, "All demo data purged.")}>
            <Button danger icon={<DeleteOutlined />}>Purge All Demo Data</Button>
          </Popconfirm>
        </Space>
      </Card>
      <Card size="small" title="Storage">
        <Typography.Text>{(estimatedStorageBytes(snapshot) / 1024 / 1024).toFixed(1)} MB estimated raw image storage.</Typography.Text>
      </Card>
    </Space>
  );
}

export function AdminFixturesPage() {
  const { snapshot } = useConsoleStore();
  const columns: ColumnsType<ReviewApplication> = [
    { title: "Fixture", render: (_, application) => application.metadata.fixtureId || application.id },
    { title: "Brand", render: (_, application) => application.expectedFields.brandName },
    { title: "Images", render: (_, application) => application.images.length },
    { title: "Expected", render: (_, application) => application.expectedOutcome },
    { title: "Status", render: (_, application) => <StatusTag status={application.status} /> },
    { title: "Path", render: (_, application) => application.metadata.packetPath || application.metadata.publicRegistryUrl || "upload" }
  ];
  return (
    <Card size="small" title="Fixture Registry">
      <Table rowKey="id" dataSource={snapshot.applications} columns={columns} pagination={{ pageSize: 10 }} scroll={{ x: 920 }} />
    </Card>
  );
}

function uniqueOptions(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter(Boolean))).map((value) => ({ value: value as string, label: value as string }));
}
