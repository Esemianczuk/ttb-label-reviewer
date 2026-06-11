import {
  AuditOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  FormOutlined,
  GithubOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  UserSwitchOutlined
} from "@ant-design/icons";
import { Alert, Button, Input, Layout, Menu, Segmented, Select, Space, Tag, Tooltip, Typography } from "antd";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import type { ProcessingMode, UserRole } from "../domain/application/types";
import { useConsoleStore } from "../hooks/useConsoleStore";
import { useCurrentRole } from "../hooks/useCurrentRole";
import { resetSnapshot } from "../providers/data/browserStore";
import { ModeTag, StatusBadge } from "../components/common/StatusTag";
import { useProcessingMode } from "../hooks/useProcessingMode";
import { canAccess } from "../providers/access/permissionMatrix";

export function AppLayout() {
  const { Header, Sider, Content } = Layout;
  const navigate = useNavigate();
  const location = useLocation();
  const { role, identity, setRole } = useCurrentRole();
  const { activeApplication } = useConsoleStore();
  const {
    mode,
    setMode,
    provider,
    health,
    backendUrl,
    setBackendUrl,
    backendUnavailable,
    fallbackToBrowser,
    clusterDashboardActive
  } = useProcessingMode();

  const selectRole = (nextRole: UserRole) => {
    setRole(nextRole);
    navigate(`/${nextRole}`);
  };

  return (
    <Layout className="app-shell">
      <Header className="app-header">
        <div className="brand-lockup">
          <SafetyCertificateOutlined />
          <div>
            <strong>TTB Label Reviewer</strong>
            <span>Refine operations console</span>
          </div>
        </div>
        <Space wrap className="header-actions">
          <ModeSwitcher mode={mode} onChange={setMode} />
          <BackendHealthTag health={health} providerLabel={provider.label} />
          <StatusBadge status={activeApplication?.status || "DRAFT"} />
          <Tooltip title="Reset applications, decisions, notes, and active queue position">
            <Button icon={<ReloadOutlined />} onClick={() => resetSnapshot()}>
              Reset Demo
            </Button>
          </Tooltip>
        </Space>
      </Header>
      <Layout>
        <Sider width={276} theme="light" breakpoint="lg" collapsedWidth={0} className="app-sider">
          <div className="role-panel">
            <Typography.Text type="secondary">Signed in as</Typography.Text>
            <Select
              value={role}
              onChange={selectRole}
              className="full-width"
              suffixIcon={<UserSwitchOutlined />}
              options={[
                { value: "reviewer", label: "Review Agent" },
                { value: "applicant", label: "Applicant" },
                { value: "admin", label: "Admin" }
              ]}
            />
            <Typography.Text type="secondary">{identity.email}</Typography.Text>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[rootKey(location.pathname)]}
            items={[
              {
                key: "reviewer",
                icon: <DashboardOutlined />,
                label: <NavLink to="/reviewer">Reviewer Portal</NavLink>
              },
              {
                key: "applicant",
                icon: <FormOutlined />,
                label: <NavLink to="/applicant">Applicant Portal</NavLink>
              },
              {
                key: "admin",
                icon: <AuditOutlined />,
                label: <NavLink to="/admin">Admin Portal</NavLink>
              }
            ].filter((item) => {
              if (item.key === "reviewer") return canAccess(role, "reviews", "list");
              if (item.key === "applicant") return canAccess(role, "applications", "list");
              if (item.key === "admin") return canAccess(role, "workers", "manage");
              return true;
            })}
          />
          <div className="sider-status">
            <Space orientation="vertical" className="full-width" size={10}>
              <div>
                <Typography.Text type="secondary">Processing mode</Typography.Text>
                <div>
                  <ModeTag mode={mode} />
                </div>
                <Typography.Text type="secondary">{provider.label}</Typography.Text>
                {clusterDashboardActive ? <Typography.Paragraph className="health-copy">Cluster dashboard enabled</Typography.Paragraph> : null}
              </div>
              <div>
                <Typography.Text type="secondary">Coordinator</Typography.Text>
                <Typography.Paragraph className="health-copy">{health.message}</Typography.Paragraph>
                {health.status === "online" ? (
                  <Typography.Paragraph className="health-copy">
                    {health.database || "database"} · static {health.staticReady ? "ready" : "missing"}
                  </Typography.Paragraph>
                ) : null}
              </div>
              <Input
                aria-label="Backend coordinator URL"
                value={backendUrl}
                prefix={<CloudServerOutlined />}
                onChange={(event) => setBackendUrl(event.target.value)}
              />
              <Button icon={<GithubOutlined />} href={import.meta.env.VITE_BROWSER_DEMO_URL || "http://127.0.0.1:5173"} target="_blank">
                Browser OCR Demo
              </Button>
            </Space>
          </div>
        </Sider>
        <Content className="app-content">
          {backendUnavailable ? (
            <Alert
              className="backend-fallback-alert"
              type="warning"
              showIcon
              message="Backend coordinator unavailable"
              description="Backend and Cluster modes use the FastAPI provider. Browser Only keeps the queue, review tools, uploads, and PDF export available offline."
              action={<Button onClick={fallbackToBrowser}>Use Browser Only</Button>}
            />
          ) : null}
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}

function BackendHealthTag({ health, providerLabel }: { health: ReturnType<typeof useProcessingMode>["health"]; providerLabel: string }) {
  const color = health.status === "online" ? "green" : health.status === "checking" ? "blue" : health.status === "offline" ? "red" : "default";
  const label =
    health.status === "online"
      ? `Backend Online${health.staticReady ? "" : " API Only"}`
      : health.status === "offline"
        ? "Backend Offline"
        : health.status === "checking"
          ? "Checking Backend"
          : providerLabel;
  const detail = [
    health.message,
    health.backendUrl,
    health.database ? `Database: ${health.database}` : "",
    health.staticDir ? `Static: ${health.staticReady ? "ready" : "missing"} at ${health.staticDir}` : "",
    health.assetRoot ? `Assets: ${health.assetRoot}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <Tooltip title={<span className="tooltip-lines">{detail}</span>}>
      <Tag color={color}>{label}</Tag>
    </Tooltip>
  );
}

function ModeSwitcher({ mode, onChange }: { mode: ProcessingMode; onChange: (mode: ProcessingMode) => void }) {
  return (
    <Segmented
      aria-label="Processing mode"
      value={mode}
      onChange={(value) => onChange(value as ProcessingMode)}
      options={[
        { label: "Browser Only", value: "browser" },
        { label: "Backend", value: "backend" },
        { label: "Cluster", value: "cluster" }
      ]}
    />
  );
}

function rootKey(pathname: string): string {
  if (pathname.startsWith("/applicant")) return "applicant";
  if (pathname.startsWith("/admin")) return "admin";
  return "reviewer";
}
