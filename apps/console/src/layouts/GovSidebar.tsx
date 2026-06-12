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
import { Button, Input, Layout, Menu, Modal, Select, Space, Typography } from "antd";
import { useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import type { ProcessingMode, UserRole } from "../domain/application/types";
import { canAccess } from "../providers/access/permissionMatrix";
import { getConsoleIdentities, roleLabel, type ConsoleIdentity } from "../providers/auth/authProvider";
import { ModeTag } from "../components/common/StatusTag";

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
  backendUrl,
  onBackendUrlChange,
  clusterDashboardActive
}: {
  role: UserRole;
  identity: ConsoleIdentity;
  onRoleChange: (role: UserRole) => void;
  mode: ProcessingMode;
  providerLabel: string;
  healthMessage: string;
  backendUrl: string;
  onBackendUrlChange: (url: string) => void;
  clusterDashboardActive: boolean;
}) {
  const { Sider } = Layout;
  const location = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);
  const nav = visibleRoleNav(role, () => setHelpOpen(true));
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
              <Typography.Text type="secondary">Processing mode</Typography.Text>
              <div>
                <ModeTag mode={mode} />
              </div>
              <Typography.Text type="secondary">{providerLabel}</Typography.Text>
              {mode === "browser" ? <Typography.Paragraph className="health-copy">Browser Only mode processes images locally in this browser session.</Typography.Paragraph> : null}
              {clusterDashboardActive ? <Typography.Paragraph className="health-copy">Cluster dashboard enabled.</Typography.Paragraph> : null}
            </div>
            <div>
              <Typography.Text type="secondary">Coordinator</Typography.Text>
              <Typography.Paragraph className="health-copy">{healthMessage}</Typography.Paragraph>
            </div>
            <Input
              aria-label="Backend coordinator URL"
              value={backendUrl}
              prefix={<CloudServerOutlined />}
              onChange={(event) => onBackendUrlChange(event.target.value)}
            />
          </Space>
        </div>
      ) : null}
      <Modal title="Role guidance" open={helpOpen} onCancel={() => setHelpOpen(false)} footer={<Button onClick={() => setHelpOpen(false)}>Close</Button>}>
        <Space orientation="vertical">
          <Typography.Text>Applicant pages collect application fields, image evidence, submissions, and corrected resubmissions.</Typography.Text>
          <Typography.Text>Reviewer pages compare expected values against OCR evidence and record human decisions.</Typography.Text>
          <Typography.Text>Admin pages monitor workers, jobs, audit events, benchmarks, and retention controls.</Typography.Text>
        </Space>
      </Modal>
    </Sider>
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
        { key: "admin-dashboard", label: "Dashboard", to: "/admin", icon: <AuditOutlined />, resource: "workers", action: "manage" },
        { key: "admin-users", label: "Users", to: "/admin/users", icon: <TeamOutlined />, resource: "users", action: "manage" },
        { key: "admin-workers", label: "Workers", to: "/admin/workers", icon: <DatabaseOutlined />, resource: "workers", action: "manage" },
        { key: "admin-jobs", label: "Jobs", to: "/admin/jobs", icon: <FileSearchOutlined />, resource: "jobs", action: "manage" },
        { key: "admin-engines", label: "OCR Engines", to: "/admin/engines", icon: <ToolOutlined />, resource: "settings", action: "manage" },
        { key: "admin-benchmarks", label: "Benchmarks", to: "/admin/benchmarks", icon: <BarChartOutlined />, resource: "benchmarks", action: "manage" },
        { key: "admin-audit", label: "Audit Log", to: "/admin/audit", icon: <SafetyCertificateOutlined />, resource: "auditEvents", action: "manage" },
        { key: "admin-retention", label: "Data Retention", to: "/admin/retention", icon: <DatabaseOutlined />, resource: "settings", action: "purge" },
        { key: "admin-settings", label: "Settings", to: "/admin/settings", icon: <SettingOutlined />, resource: "settings", action: "manage" }
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
