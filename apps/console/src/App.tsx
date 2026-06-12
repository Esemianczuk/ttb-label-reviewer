import { Refine } from "@refinedev/core";
import routerProvider, { DocumentTitleHandler, UnsavedChangesNotifier } from "@refinedev/react-router";
import { App as AntApp, ConfigProvider, theme } from "antd";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router";
import {
  AdminAuditPage,
  AdminBenchmarksPage,
  AdminEnginesPage,
  AdminFixturesPage,
  AdminJobsPage,
  AdminRetentionPage,
  AdminRolesPage,
  AdminSettingsPage,
  AdminUsersPage,
  AdminWorkersPage
} from "./pages/admin/AdminPages";
import { AdminPortal } from "./pages/admin/AdminPortal";
import { ApplicantPortal } from "./pages/applicant/ApplicantPortal";
import { ApplicantApplicationDetail } from "./pages/applicant/ApplicantApplicationDetail";
import { ApplicantTimeline } from "./pages/applicant/ApplicantTimeline";
import { NewApplicationWizard } from "./pages/applicant/NewApplicationWizard";
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
import { authProvider, roleHomePath } from "./providers/auth/authProvider";
import { createNotificationProvider } from "./providers/notification/notificationProvider";
import { ProcessingModeProvider, useProcessingModeContext } from "./providers/processing/ProcessingModeProvider";
import { consoleResources } from "./resources";
import { canAccess } from "./providers/access/permissionMatrix";
import { useCurrentRole } from "./hooks/useCurrentRole";
import { governmentTheme } from "./theme/governmentTheme";
import type { UserRole } from "./domain/application/types";

export function App() {
  return (
    <BrowserRouter>
      <ConfigProvider
        theme={{
          ...governmentTheme,
          algorithm: theme.defaultAlgorithm,
          token: governmentTheme.token
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
        liveMode: "auto",
        syncWithLocation: true,
        warnWhenUnsavedChanges: false,
        projectId: "ttb-label-reviewer-console"
      }}
    >
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<RoleLanding />} />
          <Route path="reviewer" element={<RequireAccess resource="reviews" action="list" roles={["reviewer"]}><ReviewerPortal /></RequireAccess>} />
          <Route path="reviewer/queue" element={<RequireAccess resource="reviews" action="list" roles={["reviewer"]}><ReviewQueuePage /></RequireAccess>} />
          <Route path="reviewer/applications/:applicationId" element={<RequireAccess resource="reviews" action="show" roles={["reviewer"]}><ReviewWorkbenchPage /></RequireAccess>} />
          <Route path="reviewer/batches" element={<RequireAccess resource="reviews" action="update" roles={["reviewer"]}><ReviewerBatchesPage /></RequireAccess>} />
          <Route path="reviewer/reports" element={<RequireAccess resource="reports" action="list" roles={["reviewer"]}><ReviewerReportsPage /></RequireAccess>} />
          <Route path="applicant" element={<RequireAccess resource="applications" action="list" roles={["applicant"]}><ApplicantPortal /></RequireAccess>} />
          <Route path="applicant/drafts" element={<RequireAccess resource="applications" action="list" roles={["applicant"]}><ApplicantPortal view="drafts" /></RequireAccess>} />
          <Route path="applicant/submitted" element={<RequireAccess resource="applications" action="list" roles={["applicant"]}><ApplicantPortal view="submitted" /></RequireAccess>} />
          <Route path="applicant/attention" element={<RequireAccess resource="applications" action="update" roles={["applicant"]}><ApplicantPortal view="attention" /></RequireAccess>} />
          <Route path="applicant/archived" element={<RequireAccess resource="applications" action="list" roles={["applicant"]}><ApplicantPortal view="archived" /></RequireAccess>} />
          <Route path="applicant/onboarding" element={<RequireAccess resource="applications" action="create" roles={["applicant"]}><Navigate to="/applicant/applications/new" replace /></RequireAccess>} />
          <Route path="applicant/applications/new" element={<RequireAccess resource="applications" action="create" roles={["applicant"]}><NewApplicationWizard /></RequireAccess>} />
          <Route path="applicant/applications/:applicationId/edit" element={<RequireAccess resource="applications" action="update" roles={["applicant"]}><NewApplicationWizard /></RequireAccess>} />
          <Route path="applicant/applications/:applicationId/corrections" element={<RequireAccess resource="applications" action="update" roles={["applicant"]}><ApplicantCorrectionRedirect /></RequireAccess>} />
          <Route path="applicant/applications/:applicationId" element={<RequireAccess resource="applications" action="show" roles={["applicant"]}><ApplicantApplicationDetail /></RequireAccess>} />
          <Route path="applicant/applications/:applicationId/timeline" element={<RequireAccess resource="auditEvents" action="list" roles={["applicant"]}><ApplicantTimeline /></RequireAccess>} />
          <Route path="admin" element={<RequireAccess resource="workers" action="manage" roles={["admin"]}><AdminPortal /></RequireAccess>} />
          <Route path="admin/users" element={<RequireAccess resource="users" action="manage" roles={["admin"]}><AdminUsersPage /></RequireAccess>} />
          <Route path="admin/roles" element={<RequireAccess resource="settings" action="manage" roles={["admin"]}><AdminRolesPage /></RequireAccess>} />
          <Route path="admin/workers" element={<RequireAccess resource="workers" action="manage" roles={["admin"]}><AdminWorkersPage /></RequireAccess>} />
          <Route path="admin/jobs" element={<RequireAccess resource="jobs" action="manage" roles={["admin"]}><AdminJobsPage /></RequireAccess>} />
          <Route path="admin/engines" element={<RequireAccess resource="settings" action="manage" roles={["admin"]}><AdminEnginesPage /></RequireAccess>} />
          <Route path="admin/benchmarks" element={<RequireAccess resource="benchmarks" action="manage" roles={["admin"]}><AdminBenchmarksPage /></RequireAccess>} />
          <Route path="admin/audit" element={<RequireAccess resource="auditEvents" action="manage" roles={["admin"]}><AdminAuditPage /></RequireAccess>} />
          <Route path="admin/retention" element={<RequireAccess resource="settings" action="purge" roles={["admin"]}><AdminRetentionPage /></RequireAccess>} />
          <Route path="admin/fixtures" element={<RequireAccess resource="fixtures" action="manage" roles={["admin"]}><AdminFixturesPage /></RequireAccess>} />
          <Route path="admin/settings" element={<RequireAccess resource="settings" action="manage" roles={["admin"]}><AdminSettingsPage /></RequireAccess>} />
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

function ApplicantCorrectionRedirect() {
  const { applicationId } = useParams();
  return <Navigate to={`/applicant/applications/${applicationId}/edit`} replace />;
}

export function RequireAccess({
  resource,
  action,
  roles,
  children
}: {
  resource: string;
  action: string;
  roles?: UserRole[];
  children: ReactNode;
}) {
  const { role } = useCurrentRole();
  if ((roles && !roles.includes(role)) || !canAccess(role, resource, action)) {
    return <Navigate to={roleHomePath(role)} replace />;
  }
  return <>{children}</>;
}
