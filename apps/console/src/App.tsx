import { Refine } from "@refinedev/core";
import routerProvider, { DocumentTitleHandler, UnsavedChangesNotifier } from "@refinedev/react-router";
import { App as AntApp, ConfigProvider, theme } from "antd";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { AdminPortal } from "./pages/admin/AdminPortal";
import { ApplicantPortal } from "./pages/applicant/ApplicantPortal";
import { RoleLanding } from "./pages/public/RoleLanding";
import { ReviewerPortal } from "./pages/reviewer/ReviewerPortal";
import { AppLayout } from "./layouts/AppLayout";
import { accessControlProvider } from "./providers/access/permissionMatrix";
import { auditLogProvider } from "./providers/audit/auditProvider";
import { authProvider } from "./providers/auth/authProvider";
import { browserDataProvider } from "./providers/data/browserDataProvider";
import { liveProvider } from "./providers/live/liveProvider";
import { createNotificationProvider } from "./providers/notification/notificationProvider";

export function App() {
  return (
    <BrowserRouter>
      <ConfigProvider
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: "#1f6feb",
            borderRadius: 6,
            fontFamily:
              'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          }
        }}
      >
        <AntApp>
          <ConsoleRefineShell />
        </AntApp>
      </ConfigProvider>
    </BrowserRouter>
  );
}

function ConsoleRefineShell() {
  const { notification } = AntApp.useApp();
  return (
    <Refine
      routerProvider={routerProvider}
      dataProvider={browserDataProvider}
      authProvider={authProvider}
      accessControlProvider={accessControlProvider}
      auditLogProvider={auditLogProvider}
      liveProvider={liveProvider}
      notificationProvider={createNotificationProvider(notification)}
      resources={[
        { name: "applications", list: "/reviewer", show: "/reviewer" },
        { name: "reviews", list: "/reviewer" },
        { name: "workers", list: "/admin" },
        { name: "auditEvents", list: "/admin" }
      ]}
      options={{
        syncWithLocation: true,
        warnWhenUnsavedChanges: false,
        projectId: "ttb-label-reviewer-console"
      }}
    >
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<RoleLanding />} />
          <Route path="reviewer" element={<ReviewerPortal />} />
          <Route path="applicant" element={<ApplicantPortal />} />
          <Route path="admin" element={<AdminPortal />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <UnsavedChangesNotifier />
      <DocumentTitleHandler handler={({ resource }) => `${resource?.name || "Console"} | TTB Label Reviewer`} />
    </Refine>
  );
}
