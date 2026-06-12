import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { RequireAccess } from "../../App";
import { workflowStepState } from "../../domain/application/workflow";
import { readinessIssues } from "../../pages/applicant/applicantUtils";
import { auditLogProvider } from "../../providers/audit/auditProvider";
import { authProvider, getStoredRole, setStoredRole } from "../../providers/auth/authProvider";
import { createApplicantDraft, getSnapshot, resetSnapshot, submitApplicantApplication } from "../../providers/data/browserStore";

describe("phase 16 console testing matrix", () => {
  it("auth provider stores role-scoped identity and permissions", async () => {
    await authProvider.login?.({ role: "admin" });

    expect(getStoredRole()).toBe("admin");
    await expect(authProvider.check?.({})).resolves.toEqual({ authenticated: true });
    await expect(authProvider.getIdentity?.({})).resolves.toMatchObject({ role: "admin", email: "admin@example.local" });
    await expect(authProvider.getPermissions?.({})).resolves.toEqual({ role: "admin" });
  });

  it("creates audit records through the Refine audit provider", async () => {
    setStoredRole("reviewer");
    const event = await auditLogProvider.create?.({
      resource: "reviews",
      action: "override",
      data: { fieldKey: "brandName" },
      author: { name: "Matrix Reviewer" },
      meta: { applicationId: "app-matrix" }
    });
    const events = await auditLogProvider.get?.({ resource: "reviews", action: "override" });

    expect(event).toMatchObject({ action: "override", role: "reviewer", resource: "reviews" });
    expect(events?.[0]).toMatchObject({ actor: "Matrix Reviewer", metadata: { data: { fieldKey: "brandName" }, meta: { applicationId: "app-matrix" } } });
  });

  it("redirects mismatched workspaces to the active role home", async () => {
    setStoredRole("applicant");

    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route
            path="/admin"
            element={
              <RequireAccess resource="workers" action="manage" roles={["admin"]}>
                <div>Admin workspace</div>
              </RequireAccess>
            }
          />
          <Route path="/applicant" element={<div>Applicant home</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Applicant home")).toBeInTheDocument();
    expect(screen.queryByText("Admin workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Access denied")).not.toBeInTheDocument();
  });

  it("marks workflow milestones with process, finish, and error states", () => {
    expect(workflowStepState("SUBMITTED", 0)).toBe("finish");
    expect(workflowStepState("SUBMITTED", 1)).toBe("process");
    expect(workflowStepState("NEEDS_CORRECTION", 2)).toBe("error");
    expect(workflowStepState("REJECTED", 3)).toBe("error");
  });

  it("reports applicant readiness issues and direct submission audit events", () => {
    resetSnapshot();
    const application = getSnapshot().applications[0];
    expect(readinessIssues({ ...application, images: [], expectedFields: { ...application.expectedFields, brandName: "" } })).toEqual(
      expect.arrayContaining(["At least one label image is required.", "Brand name is required."])
    );

    const draft = createApplicantDraft({
      expectedFields: application.expectedFields,
      images: application.images,
      submitter: "Applicant"
    });
    submitApplicantApplication(draft.activeApplicationId);

    const submitted = getSnapshot().applications.find((candidate) => candidate.id === draft.activeApplicationId);
    expect(submitted?.status).toBe("SUBMITTED");
    expect(submitted?.review).toBeUndefined();
    expect(getSnapshot().auditEvents[0]).toMatchObject({ action: "application.submit", resource: "applications" });
  });
});
