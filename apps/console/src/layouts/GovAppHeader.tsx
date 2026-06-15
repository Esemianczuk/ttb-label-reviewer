import { CloudServerOutlined, QuestionCircleOutlined, ReloadOutlined, SafetyCertificateOutlined, UserSwitchOutlined } from "@ant-design/icons";
import { Button, Select, Space, Tag, Tooltip } from "antd";
import type { ProcessingMode, UserRole } from "../domain/application/types";
import { getConsoleIdentities, roleLabel, type ConsoleIdentity } from "../providers/auth/authProvider";

type Health = {
  status: string;
  message: string;
  warning?: string;
  staticReady?: boolean;
};

export function GovAppHeader({
  mode,
  health,
  role,
  identity,
  onRoleChange,
  onGuidanceOpen,
  onReset
}: {
  mode: ProcessingMode;
  health: Health;
  role: UserRole;
  identity: ConsoleIdentity;
  onRoleChange: (role: UserRole) => void;
  onGuidanceOpen: () => void;
  onReset: () => void;
}) {
  const showOperationsControls = role === "admin";
  const accountOptions = getConsoleIdentities().map((account) => ({
    value: account.role,
    label: `${roleLabel(account.role)} - ${account.email}`
  }));
  return (
    <header className="gov-app-header">
      <div className="brand-lockup">
        <SafetyCertificateOutlined aria-hidden="true" />
        <div>
          <strong>TTB Label Reviewer</strong>
          <span className="gov-app-header-subtitle">COLA submission and specialist review platform</span>
          <Select
            aria-label="Switch demo role"
            className="account-switcher mobile-account-switcher"
            value={identity.role}
            onChange={(nextRole) => onRoleChange(nextRole)}
            suffixIcon={<UserSwitchOutlined />}
            options={accountOptions}
          />
          <Button className="mobile-header-guidance-button" icon={<QuestionCircleOutlined />} onClick={onGuidanceOpen}>
            Guidance
          </Button>
        </div>
      </div>
      <Space wrap className="header-actions">
        {showOperationsControls ? (
          <BackendHealthPill health={health} mode={mode} />
        ) : null}
        <Tooltip title="Reset applications, decisions, notes, and return to the first demo packet">
          <Button icon={<ReloadOutlined />} onClick={onReset}>
            Reset Demo
          </Button>
        </Tooltip>
      </Space>
    </header>
  );
}

function BackendHealthPill({ health, mode }: { health: Health; mode: ProcessingMode }) {
  const label =
    health.status === "online"
      ? health.warning
        ? "Backend primary - LAN"
        : "Backend primary"
      : health.status === "checking"
        ? "Backend checking"
        : health.status === "offline"
          ? "Browser fallback"
          : mode === "browser"
            ? "Browser fallback"
            : "Backend primary";
  const color = health.status === "online" ? "green" : health.status === "checking" ? "blue" : health.status === "offline" ? "red" : "default";
  return (
    <Tooltip title={health.message}>
      <Tag color={color} icon={<CloudServerOutlined />}>
        {label}
      </Tag>
    </Tooltip>
  );
}
