import { Refine } from "@refinedev/core";
import routerProvider, { DocumentTitleHandler, UnsavedChangesNotifier } from "@refinedev/react-router";
import { App as AntApp, ConfigProvider, theme } from "antd";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { AdminPortal } from "./pages/admin/AdminPortal";
import { ApplicantPortal } from "./pages/applicant/ApplicantPortal";
import { ApplicantApplicationDetail } from "./pages/applicant/ApplicantApplicationDetail";
import { ApplicantOnboarding } from "./pages/applicant/ApplicantOnboarding";
import { ApplicantTimeline } from "./pages/applicant/ApplicantTimeline";
import { CorrectionResponsePage } from "./pages/applicant/CorrectionResponsePage";
import { NewApplicationWizard } from "./pages/applicant/NewApplicationWizard";
import { PrecheckPage } from "./pages/applicant/PrecheckPage";
import { AccessDeniedPage } from "./pages/public/AccessDeniedPage";
import { RoleLanding } from "./pages/public/RoleLanding";
import { ReviewQueuePage } from "./pages/reviewer/ReviewQueuePage";
import { ReviewerBatchesPage } from "./pages/reviewer/ReviewerBatchesPage";
import { ReviewerPortal } from "./pages/reviewer/ReviewerPortal";
import { ReviewerReportsPage } from "./pages/reviewer/ReviewerReportsPage";
import { ReviewWorkbenchPage } from "./pages/reviewer/ReviewWorkbenchPage";
import { ResourceIndexPage } from "./pages/resources/ResourceIndexPage";
import { AppLayout } from "./layouts/AppLayout";
import { accessControlProvider } from "./providers/access/permissionMatrix";
import { auditLogProvider } from "./providers/audit/auditProvider";
import { authProvider } from "./providers/auth/authProvider";
import { createNotificationProvider } from "./providers/notification/notificationProvider";
import { ProcessingModeProvider, useProcessingModeContext } from "./providers/processing/ProcessingModeProvider";
import { consoleResources } from "./resources";
import { canAccess } from "./providers/access/permissionMatrix";
import { useCurrentRole } from "./hooks/useCurrentRole";

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
          <ProcessingModeProvider>
            <ConsoleRefineShell />
          </ProcessingModeProvider>
        </AntApp>
      </ConfigProvider>
    </BrowserRouter>
  );
}

function ConsoleRefineShell() {
  const { notification } = AntApp.useApp();
  const { dataProvider, liveProvider } = useProcessingModeContext();
  return (
    <Refine
      routerProvider={routerProvider}
      dataProvider={dataProvider}
      authProvider={authProvider}
      accessControlProvider={accessControlProvider}
      auditLogProvider={auditLogProvider}
      liveProvider={liveProvider}
      notificationProvider={createNotificationProvider(notification)}
      resources={consoleResources}
      options={{
        syncWithLocation: true,
        warnWhenUnsavedChanges: false,
        projectId: "ttb-label-reviewer-console"
      }}
    >
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<RoleLanding />} />
          <Route path="reviewer" element={<RequireAccess resource="reviews" action="list"><ReviewerPortal /></RequireAccess>} />
          <Route path="reviewer/queue" element={<RequireAccess resource="reviews" action="list"><ReviewQueuePage /></RequireAccess>} />
          <Route path="reviewer/applications/:applicationId" element={<RequireAccess resource="reviews" action="show"><ReviewWorkbenchPage /></RequireAccess>} />
          <Route path="reviewer/batches" element={<RequireAccess resource="reviews" action="update"><ReviewerBatchesPage /></RequireAccess>} />
          <Route path="reviewer/reports" element={<RequireAccess resource="reports" action="list"><ReviewerReportsPage /></RequireAccess>} />
          <Route path="applicant" element={<RequireAccess resource="applications" action="list"><ApplicantPortal /></RequireAccess>} />
          <Route path="applicant/onboarding" element={<RequireAccess resource="applications" action="create"><ApplicantOnboarding /></RequireAccess>} />
          <Route path="applicant/applications/new" element={<RequireAccess resource="applications" action="create"><NewApplicationWizard /></RequireAccess>} />
          <Route path="applicant/applications/:applicationId" element={<RequireAccess resource="applications" action="show"><ApplicantApplicationDetail /></RequireAccess>} />
          <Route path="applicant/applications/:applicationId/precheck" element={<RequireAccess resource="applications" action="submit"><PrecheckPage /></RequireAccess>} />
          <Route path="applicant/applications/:applicationId/corrections" element={<RequireAccess resource="correctionRequests" action="respond"><CorrectionResponsePage /></RequireAccess>} />
          <Route path="applicant/applications/:applicationId/timeline" element={<RequireAccess resource="auditEvents" action="list"><ApplicantTimeline /></RequireAccess>} />
          <Route path="admin" element={<RequireAccess resource="workers" action="manage"><AdminPortal /></RequireAccess>} />
          <Route path="resources/:resourceName" element={<ResourceIndexPage />} />
          <Route path="resources/:resourceName/:id" element={<ResourceIndexPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <UnsavedChangesNotifier />
      <DocumentTitleHandler handler={({ resource }) => `${resource?.name || "Console"} | TTB Label Reviewer`} />
    </Refine>
  );
}

function RequireAccess({
  resource,
  action,
  children
}: {
  resource: string;
  action: string;
  children: ReactNode;
}) {
  const { role } = useCurrentRole();
  if (!canAccess(role, resource, action)) return <AccessDeniedPage />;
  return <>{children}</>;
}
