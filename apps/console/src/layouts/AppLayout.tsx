import { Button, Layout, Modal, Space, Typography } from "antd";
import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import type { UserRole } from "../domain/application/types";
import { useCurrentRole } from "../hooks/useCurrentRole";
import { resetSnapshot } from "../providers/data/browserStore";
import { useProcessingMode } from "../hooks/useProcessingMode";
import { GovAlert } from "../components/common/GovAlert";
import { GovAppHeader } from "./GovAppHeader";
import { GovSidebar, GuidanceModalContent } from "./GovSidebar";
import { guidanceForPath } from "./pageGuidance";
import { roleHomePath } from "../providers/auth/authProvider";

export function AppLayout() {
  const { Content } = Layout;
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileGuidanceOpen, setMobileGuidanceOpen] = useState(false);
  const { role, identity, setRole } = useCurrentRole();
  const {
    mode,
    provider,
    health,
    backendUrl,
    backendUnavailable
  } = useProcessingMode();

  const selectRole = (nextRole: UserRole) => {
    setRole(nextRole);
    navigate(roleHomePath(nextRole), { replace: true });
  };

  const resetDemo = () => {
    const snapshot = resetSnapshot();
    if (role === "reviewer" && snapshot.activeApplicationId) {
      navigate(`/reviewer/applications/${snapshot.activeApplicationId}`, { replace: true });
      return;
    }
    navigate(roleHomePath(role), { replace: true });
  };

  const guidance = guidanceForPath(location.pathname, role);

  return (
    <Layout className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <GovAppHeader
        mode={mode}
        health={health}
        role={role}
        identity={identity}
        onRoleChange={selectRole}
        onGuidanceOpen={() => setMobileGuidanceOpen(true)}
        onReset={resetDemo}
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
        />
        <Content id="main-content" className="app-content">
          {role === "admin" && health.warning ? (
            <GovAlert type="warning" title="LAN mode enabled">
              {health.warning}
            </GovAlert>
          ) : null}
          {role === "admin" && backendUnavailable ? (
            <div className="backend-fallback-alert">
              <GovAlert type="warning" title="Backend coordinator unavailable">
                The console has fallen back to browser-local OCR. Start the local FastAPI/PaddleOCR runner to return to the primary backend path automatically.
              </GovAlert>
            </div>
          ) : null}
          <Outlet />
        </Content>
        <Modal
          title={(
            <Space orientation="vertical" size={0} className="page-guidance-title">
              <Typography.Text type="secondary">{guidance.scope} guidance</Typography.Text>
              <Typography.Text strong>{guidance.title}</Typography.Text>
            </Space>
          )}
          className="page-guidance-modal"
          width={760}
          open={mobileGuidanceOpen}
          onCancel={() => setMobileGuidanceOpen(false)}
          footer={<Button onClick={() => setMobileGuidanceOpen(false)}>Close</Button>}
        >
          <GuidanceModalContent guidance={guidance} />
        </Modal>
      </Layout>
    </Layout>
  );
}
