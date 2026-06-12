import { CloudServerOutlined, ReloadOutlined, SafetyCertificateOutlined, UserSwitchOutlined } from "@ant-design/icons";
import { Button, Segmented, Select, Space, Tag, Tooltip } from "antd";
import type { ProcessingMode, UserRole } from "../domain/application/types";
import { getConsoleIdentities, roleLabel, type ConsoleIdentity } from "../providers/auth/authProvider";
import { ModeTag } from "../components/common/StatusTag";

type Health = {
  status: string;
  message: string;
  warning?: string;
  staticReady?: boolean;
};

export function GovAppHeader({
  mode,
  onModeChange,
  health,
  role,
  identity,
  onRoleChange,
  onReset
}: {
  mode: ProcessingMode;
  onModeChange: (mode: ProcessingMode) => void;
  health: Health;
  role: UserRole;
  identity: ConsoleIdentity;
  onRoleChange: (role: UserRole) => void;
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
        </div>
      </div>
      <Space wrap className="header-actions">
        {showOperationsControls ? (
          <>
            <Segmented
              aria-label="Processing mode"
              value={mode}
              onChange={(value) => onModeChange(value as ProcessingMode)}
              options={[
                { label: "Browser Only", value: "browser" },
                { label: "Backend", value: "backend" },
                { label: "Cluster", value: "cluster" }
              ]}
            />
            <ModeTag mode={mode} />
            <BackendHealthPill health={health} />
          </>
        ) : null}
        <Tooltip title="Reset applications, decisions, notes, and active queue position">
          <Button icon={<ReloadOutlined />} onClick={onReset}>
            Reset Demo
          </Button>
        </Tooltip>
      </Space>
    </header>
  );
}

function BackendHealthPill({ health }: { health: Health }) {
  const label =
    health.status === "online"
      ? health.warning
        ? "Backend connected - LAN"
        : "Backend connected"
      : health.status === "checking"
        ? "Backend checking"
        : health.status === "offline"
          ? "Backend offline"
          : "Backend optional";
  const color = health.status === "online" ? "green" : health.status === "checking" ? "blue" : health.status === "offline" ? "red" : "default";
  return (
    <Tooltip title={health.message}>
      <Tag color={color} icon={<CloudServerOutlined />}>
        {label}
      </Tag>
    </Tooltip>
  );
}
