import type { DataProvider } from "@refinedev/core";
import {
  addManualUpload,
  autoReviewApplication,
  createApplicantDraft,
  getSnapshot,
  requestApplicantCorrection,
  respondToApplicantCorrection,
  resetSnapshot,
  runApplicantPrecheck,
  setActiveApplication,
  setProcessingMode,
  submitApplicantApplication,
  updateFieldDecision,
  updateReviewNotes,
  withdrawApplicantApplication,
  upsertApplication
} from "./browserStore";
import { snapshotResourceData } from "./snapshotResources";

export const browserDataProvider: DataProvider = {
  getList: async ({ resource }) => {
    const snapshot = getSnapshot();
    const data = resourceData(resource);
    return { data, total: data.length };
  },
  getOne: async ({ resource, id }) => {
    const data = resourceData(resource).find((item) => String(item.id) === String(id));
    if (!data) throw new Error(`${resource} record ${id} was not found.`);
    return { data };
  },
  create: async ({ resource, variables }) => {
    if (resource === "applications") {
      const snapshot = upsertApplication(variables as any);
      return { data: snapshot.applications.find((application) => application.id === (variables as any).id) as any };
    }
    throw new Error(`Create is not implemented for ${resource}.`);
  },
  update: async ({ resource, id, variables }) => {
    if (resource === "applications") {
      const existing = getSnapshot().applications.find((application) => application.id === String(id));
      if (!existing) throw new Error(`Application ${id} was not found.`);
      const snapshot = upsertApplication({ ...existing, ...(variables as any), updatedAt: new Date().toISOString() });
      return { data: snapshot.applications.find((application) => application.id === String(id)) as any };
    }
    throw new Error(`Update is not implemented for ${resource}.`);
  },
  deleteOne: async ({ id }) => {
    return { data: { id } as any };
  },
  getApiUrl: () => "browser://ttb-console",
  custom: async ({ url, method, payload }) => {
    const action = String(url || "").replace(/^\/+/, "");
    if (method && !["get", "post", "patch", "put"].includes(method.toLowerCase())) {
      throw new Error(`Unsupported browser data method ${method}.`);
    }
    if (action === "demo/reset") return { data: resetSnapshot() as any };
    if (action === "mode") return { data: setProcessingMode((payload as any).mode) as any };
    if (action === "applications/active") return { data: setActiveApplication((payload as any).applicationId) as any };
    if (action === "reviews/auto") return { data: autoReviewApplication((payload as any).applicationId, (payload as any).mode) as any };
    if (action === "reviews/field") return { data: updateFieldDecision(payload as any) as any };
    if (action === "reviews/notes") return { data: updateReviewNotes(payload as any) as any };
    if (action === "applications/manual") return { data: addManualUpload(payload as any) as any };
    if (action === "applications/draft") return { data: createApplicantDraft(payload as any) as any };
    if (action === "applications/precheck") return { data: runApplicantPrecheck((payload as any).applicationId, (payload as any).mode) as any };
    if (action === "applications/submit") return { data: submitApplicantApplication((payload as any).applicationId) as any };
    if (action === "applications/withdraw") return { data: withdrawApplicantApplication((payload as any).applicationId) as any };
    if (action === "corrections/request") return { data: requestApplicantCorrection(payload as any) as any };
    if (action === "corrections/respond") return { data: respondToApplicantCorrection(payload as any) as any };
    throw new Error(`Browser data action ${action} is not implemented.`);
  }
};

function resourceData(resource: string): any[] {
  return snapshotResourceData(resource, getSnapshot());
}
