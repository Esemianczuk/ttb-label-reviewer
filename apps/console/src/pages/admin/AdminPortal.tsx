import {
  AuditOutlined,
  BarChartOutlined,
  ClusterOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  ToolOutlined
} from "@ant-design/icons";
import { Button, Card, Col, Descriptions, Row, Space, Statistic, Typography } from "antd";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { StatusTag } from "../../components/common/StatusTag";
import { useBackendHealth } from "../../hooks/useBackendHealth";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { adminMetrics } from "./adminUtils";

const adminRoutes = [
  { to: "/admin/users", label: "Users", icon: <TeamOutlined /> },
  { to: "/admin/roles", label: "Roles", icon: <SafetyCertificateOutlined /> },
  { to: "/admin/workers", label: "Workers", icon: <ClusterOutlined /> },
  { to: "/admin/jobs", label: "Jobs", icon: <FileSearchOutlined /> },
  { to: "/admin/engines", label: "Engines", icon: <ToolOutlined /> },
  { to: "/admin/benchmarks", label: "Benchmarks", icon: <BarChartOutlined /> },
  { to: "/admin/audit", label: "Audit", icon: <AuditOutlined /> },
  { to: "/admin/retention", label: "Retention", icon: <DeleteOutlined /> },
  { to: "/admin/fixtures", label: "Fixtures", icon: <FolderOpenOutlined /> },
  { to: "/admin/settings", label: "Settings", icon: <SettingOutlined /> }
];

export function AdminPortal() {
  const { snapshot, activeApplication } = useConsoleStore();
  const { health } = useBackendHealth();
  const metrics = adminMetrics(snapshot);

  return (
    <Space orientation="vertical" className="full-width" size={16}>
      <Row gutter={[16, 16]}>
        <MetricCard title="Applications Today" value={metrics.applicationsToday} icon={<DatabaseOutlined />} />
        <MetricCard title="Submitted" value={metrics.submitted} icon={<FileSearchOutlined />} />
        <MetricCard title="Needs Review" value={metrics.needsReview} icon={<AuditOutlined />} />
        <MetricCard title="Approved" value={metrics.approved} icon={<SafetyCertificateOutlined />} />
        <MetricCard title="Rejected" value={metrics.rejected} icon={<DeleteOutlined />} danger={metrics.rejected > 0} />
        <MetricCard title="Active Workers" value={metrics.activeWorkers} icon={<ClusterOutlined />} />
        <MetricCard title="Queue Depth" value={metrics.queueDepth} icon={<FileSearchOutlined />} />
        <MetricCard title="Images / Min" value={metrics.imagesPerMinute} icon={<BarChartOutlined />} />
        <MetricCard title="p50 OCR Time" value={metrics.p50OcrMs} suffix="ms" icon={<BarChartOutlined />} />
        <MetricCard title="p95 OCR Time" value={metrics.p95OcrMs} suffix="ms" icon={<BarChartOutlined />} />
        <MetricCard title="Failed Jobs" value={metrics.failedJobs} icon={<DeleteOutlined />} danger={metrics.failedJobs > 0} />
        <MetricCard title="Storage Used" value={metrics.storageUsedMb} suffix="MB" icon={<DatabaseOutlined />} />
      </Row>

      <Card size="small" title="Operations Dashboard">
        <Row gutter={[12, 12]}>
          {adminRoutes.map((route) => (
            <Col xs={12} md={8} xl={6} key={route.to}>
              <Button className="admin-route-button" icon={route.icon}>
                <Link to={route.to}>{route.label}</Link>
              </Button>
            </Col>
          ))}
        </Row>
      </Card>

      <Card size="small" title="Coordinator Health">
        <Descriptions column={{ xs: 1, md: 2 }} bordered size="small">
          <Descriptions.Item label="Backend">{health.status}</Descriptions.Item>
          <Descriptions.Item label="Message">{health.message}</Descriptions.Item>
          <Descriptions.Item label="Processing Mode">{snapshot.processingMode}</Descriptions.Item>
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
  );
}

function MetricCard({
  title,
  value,
  suffix,
  icon,
  danger = false
}: {
  title: string;
  value: number;
  suffix?: string;
  icon: ReactNode;
  danger?: boolean;
}) {
  return (
    <Col xs={24} sm={12} lg={8} xl={6}>
      <Card size="small">
        <Statistic title={title} value={value} suffix={suffix} prefix={icon} valueStyle={{ color: danger ? "#b42318" : undefined }} />
      </Card>
    </Col>
  );
}
