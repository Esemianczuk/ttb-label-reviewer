import {
  AuditOutlined,
  BarChartOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  FileAddOutlined,
  FileDoneOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  FormOutlined,
  QuestionCircleOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  ToolOutlined,
  UserSwitchOutlined
} from "@ant-design/icons";
import { Alert, Button, Input, Layout, Menu, Modal, Select, Space, Typography } from "antd";
import { useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import type { ProcessingMode, UserRole } from "../domain/application/types";
import { canAccess } from "../providers/access/permissionMatrix";
import { getConsoleIdentities, roleLabel, type ConsoleIdentity } from "../providers/auth/authProvider";
import { ModeTag } from "../components/common/StatusTag";
import { guidanceForPath, type PageGuidance } from "./pageGuidance";

type NavItem = {
  key: string;
  label: string;
  to?: string;
  icon: ReactNode;
  resource?: string;
  action?: string;
  onClick?: () => void;
};

export function GovSidebar({
  role,
  identity,
  onRoleChange,
  mode,
  providerLabel,
  healthMessage,
  backendUrl
}: {
  role: UserRole;
  identity: ConsoleIdentity;
  onRoleChange: (role: UserRole) => void;
  mode: ProcessingMode;
  providerLabel: string;
  healthMessage: string;
  backendUrl: string;
}) {
  const { Sider } = Layout;
  const location = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);
  const nav = visibleRoleNav(role, () => setHelpOpen(true));
  const guidance = guidanceForPath(location.pathname, role);
  const accountOptions = getConsoleIdentities().map((account) => ({
    value: account.role,
    label: `${roleLabel(account.role)} - ${account.email}`
  }));

  return (
    <Sider width={292} theme="light" breakpoint="lg" collapsedWidth={0} className="app-sider gov-sidebar">
      <div className="role-panel">
        <Typography.Text type="secondary">Switch demo role</Typography.Text>
        <Select
          aria-label="Switch demo role"
          className="account-switcher sidebar-account-switcher"
          value={identity.role}
          onChange={(nextRole) => onRoleChange(nextRole)}
          suffixIcon={<UserSwitchOutlined />}
          options={accountOptions}
        />
      </div>
      {nav.map((section) => (
        <div key={section.label}>
          <div className="gov-sidebar-section">{section.label}</div>
          <Menu
            mode="inline"
            selectedKeys={[selectedNavKey(location.pathname, nav)]}
            items={section.items.map((item) => ({
              key: item.key,
              icon: item.icon,
              label: item.to ? <NavLink to={item.to}>{item.label}</NavLink> : item.label,
              onClick: item.onClick
            }))}
          />
        </div>
      ))}
      {role === "admin" ? (
        <div className="gov-sidebar-status">
          <Space orientation="vertical" className="full-width" size={10}>
            <div>
              <Typography.Text type="secondary">Runtime path</Typography.Text>
              <div>
              <ModeTag mode={mode} />
              </div>
              <Typography.Text type="secondary">{providerLabel}</Typography.Text>
              {mode === "browser" ? <Typography.Paragraph className="health-copy">Offline fallback is active because the backend coordinator is not reachable.</Typography.Paragraph> : null}
              {mode === "backend" ? <Typography.Paragraph className="health-copy">Primary backend path uses FastAPI, PaddleOCR full-image OCR, guarded field extraction, and deterministic validators.</Typography.Paragraph> : null}
            </div>
            <div>
              <Typography.Text type="secondary">Coordinator</Typography.Text>
              <Typography.Paragraph className="health-copy">{healthMessage}</Typography.Paragraph>
            </div>
            <Input
              aria-label="Backend coordinator URL"
              value={backendUrl}
              prefix={<CloudServerOutlined />}
              readOnly
            />
          </Space>
        </div>
      ) : null}
      <Modal
        title={(
          <Space orientation="vertical" size={0} className="page-guidance-title">
            <Typography.Text type="secondary">{guidance.scope} guidance</Typography.Text>
            <Typography.Text strong>{guidance.title}</Typography.Text>
          </Space>
        )}
        className="page-guidance-modal"
        width={760}
        open={helpOpen}
        onCancel={() => setHelpOpen(false)}
        footer={<Button onClick={() => setHelpOpen(false)}>Close</Button>}
      >
        <GuidanceModalContent guidance={guidance} />
      </Modal>
    </Sider>
  );
}

export function GuidanceModalContent({ guidance }: { guidance: PageGuidance }) {
  return (
    <div className="page-guidance">
      <Typography.Paragraph className="page-guidance-summary">{guidance.summary}</Typography.Paragraph>
      {guidance.blocks.map((block) => (
        <section className="page-guidance-block" key={block.heading}>
          <Typography.Title level={5}>{block.heading}</Typography.Title>
          <ul className="page-guidance-list">
            {block.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
      {guidance.footer ? <Alert type="info" showIcon message={guidance.footer} /> : null}
    </div>
  );
}

function visibleRoleNav(role: UserRole, openHelp: () => void): Array<{ label: string; items: NavItem[] }> {
  const sections: Record<UserRole, Array<{ label: string; items: NavItem[] }>> = {
    applicant: [{
      label: "Applicant",
      items: [
        { key: "applicant-dashboard", label: "Dashboard", to: "/applicant", icon: <FormOutlined />, resource: "applications", action: "list" },
        { key: "applicant-new", label: "New Application", to: "/applicant/applications/new", icon: <FileAddOutlined />, resource: "applications", action: "create" },
        { key: "applicant-drafts", label: "Drafts", to: "/applicant/drafts", icon: <FolderOpenOutlined />, resource: "applications", action: "list" },
        { key: "applicant-submitted", label: "Submitted", to: "/applicant/submitted", icon: <FileDoneOutlined />, resource: "applications", action: "list" },
        { key: "applicant-corrections", label: "Needs Attention", to: "/applicant/attention", icon: <ClockCircleOutlined />, resource: "applications", action: "update" },
        { key: "applicant-guidance", label: "Guidance", icon: <QuestionCircleOutlined />, onClick: openHelp, resource: "applications", action: "list" }
      ]
    }],
    reviewer: [{
      label: "Review",
      items: [
        { key: "reviewer-dashboard", label: "Dashboard", to: "/reviewer", icon: <FileSearchOutlined />, resource: "reviews", action: "list" },
        { key: "reviewer-queue", label: "Review Queue", to: "/reviewer/queue", icon: <FileSearchOutlined />, resource: "reviews", action: "list" },
        { key: "reviewer-batches", label: "Batch Review", to: "/reviewer/batches", icon: <DatabaseOutlined />, resource: "reviews", action: "update" },
        { key: "reviewer-reports", label: "Reports", to: "/reviewer/reports", icon: <BarChartOutlined />, resource: "reports", action: "list" },
        { key: "reviewer-guidance", label: "Guidance", icon: <QuestionCircleOutlined />, onClick: openHelp, resource: "reviews", action: "list" }
      ]
    }],
    admin: [{
      label: "Operations",
      items: [
        { key: "admin-dashboard", label: "Dashboard", to: "/admin", icon: <AuditOutlined />, resource: "workers", action: "list" },
        { key: "admin-users", label: "Users", to: "/admin/users", icon: <TeamOutlined />, resource: "users", action: "list" },
        { key: "admin-workers", label: "Workers", to: "/admin/workers", icon: <DatabaseOutlined />, resource: "workers", action: "list" },
        { key: "admin-jobs", label: "Jobs", to: "/admin/jobs", icon: <FileSearchOutlined />, resource: "jobs", action: "list" },
        { key: "admin-engines", label: "OCR Engines", to: "/admin/engines", icon: <ToolOutlined />, resource: "settings", action: "show" },
        { key: "admin-benchmarks", label: "Benchmarks", to: "/admin/benchmarks", icon: <BarChartOutlined />, resource: "benchmarks", action: "list" },
        { key: "admin-audit", label: "Audit Log", to: "/admin/audit", icon: <SafetyCertificateOutlined />, resource: "auditEvents", action: "list" },
        { key: "admin-retention", label: "Data Retention", to: "/admin/retention", icon: <DatabaseOutlined />, resource: "settings", action: "show" },
        { key: "admin-settings", label: "Settings", to: "/admin/settings", icon: <SettingOutlined />, resource: "settings", action: "show" },
        { key: "admin-guidance", label: "Guidance", icon: <QuestionCircleOutlined />, onClick: openHelp, resource: "settings", action: "show" }
      ]
    }]
  };
  return sections[role]
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.resource || canAccess(role, item.resource, item.action || "list"))
    }))
    .filter((section) => section.items.length > 0);
}

function selectedNavKey(pathname: string, sections: Array<{ items: NavItem[] }>): string {
  const candidates = sections.flatMap((section) => section.items).filter((item) => item.to && pathname.startsWith(item.to));
  return candidates.sort((a, b) => (b.to?.length || 0) - (a.to?.length || 0))[0]?.key || "";
}
