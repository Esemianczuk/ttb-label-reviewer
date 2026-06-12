import { Button, Layout } from "antd";
import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router";
import type { UserRole } from "../domain/application/types";
import { useCurrentRole } from "../hooks/useCurrentRole";
import { resetSnapshot } from "../providers/data/browserStore";
import { useProcessingMode } from "../hooks/useProcessingMode";
import { GovAlert } from "../components/common/GovAlert";
import { GovAppHeader } from "./GovAppHeader";
import { GovSidebar } from "./GovSidebar";
import { roleHomePath } from "../providers/auth/authProvider";

export function AppLayout() {
  const { Content } = Layout;
  const navigate = useNavigate();
  const { role, identity, setRole } = useCurrentRole();
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
    navigate(roleHomePath(nextRole), { replace: true });
  };

  useEffect(() => {
    if (role !== "admin" && mode !== "browser") setMode("browser");
  }, [mode, role, setMode]);

  return (
    <Layout className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <GovAppHeader
        mode={mode}
        onModeChange={setMode}
        health={health}
        role={role}
        identity={identity}
        onRoleChange={selectRole}
        onReset={() => resetSnapshot()}
      />
      <Layout>
        <GovSidebar
          role={role}
          identity={identity}
          onRoleChange={selectRole}
          mode={mode}
          providerLabel={provider.label}
          healthMessage={health.message}
          backendUrl={backendUrl}
          onBackendUrlChange={setBackendUrl}
          clusterDashboardActive={clusterDashboardActive}
        />
        <Content id="main-content" className="app-content">
          {role === "admin" && health.warning ? (
            <GovAlert type="warning" title="LAN mode enabled">
              {health.warning}
            </GovAlert>
          ) : null}
          {role === "admin" && backendUnavailable ? (
            <div className="backend-fallback-alert">
              <GovAlert type="warning" title="Backend coordinator unavailable" action={<Button onClick={fallbackToBrowser}>Use Browser Only</Button>}>
                Backend and Cluster modes use the FastAPI provider. Browser Only keeps the queue, review tools, uploads, and PDF export available offline.
              </GovAlert>
            </div>
          ) : null}
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
