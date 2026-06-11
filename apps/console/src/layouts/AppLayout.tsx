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
import { Button, Input, Layout, Menu, Segmented, Select, Space, Tooltip, Typography } from "antd";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import type { ProcessingMode, UserRole } from "../domain/application/types";
import { useBackendHealth } from "../hooks/useBackendHealth";
import { useConsoleStore } from "../hooks/useConsoleStore";
import { useCurrentRole } from "../hooks/useCurrentRole";
import { setProcessingMode, resetSnapshot } from "../providers/data/browserStore";
import { ModeTag, StatusBadge } from "../components/common/StatusTag";

export function AppLayout() {
  const { Header, Sider, Content } = Layout;
  const navigate = useNavigate();
  const location = useLocation();
  const { role, identity, setRole } = useCurrentRole();
  const { snapshot, activeApplication } = useConsoleStore();
  const { health, backendUrl, setBackendUrl } = useBackendHealth();

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
          <ModeSwitcher mode={snapshot.processingMode} onChange={setProcessingMode} />
          <StatusBadge status={activeApplication?.status || "draft"} />
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
            ]}
          />
          <div className="sider-status">
            <Space orientation="vertical" className="full-width" size={10}>
              <div>
                <Typography.Text type="secondary">Processing mode</Typography.Text>
                <div>
                  <ModeTag mode={snapshot.processingMode} />
                </div>
              </div>
              <div>
                <Typography.Text type="secondary">Coordinator</Typography.Text>
                <Typography.Paragraph className="health-copy">{health.message}</Typography.Paragraph>
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
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}

function ModeSwitcher({ mode, onChange }: { mode: ProcessingMode; onChange: (mode: ProcessingMode) => void }) {
  return (
    <Segmented
      aria-label="Processing mode"
      value={mode}
      onChange={(value) => onChange(value as ProcessingMode)}
      options={[
        { label: "Browser", value: "browser" },
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
