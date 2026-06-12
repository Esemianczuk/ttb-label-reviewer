import type { DataProvider } from "@refinedev/core";
import {
  addManualUpload,
  acceptAutoReview,
  archiveApplicantApplication,
  autosaveApplicantDraft,
  autoReviewApplication,
  autoReviewApplicationWithBrowserOcr,
  createApplicantDraft,
  deleteApplicantDraft,
  deleteApplicationPacket,
  finalizeReviewerDecision,
  getSnapshot,
  purgeAllDemoData,
  purgeOldJobs,
  purgeRawImages,
  processReviewerBatch,
  requestApplicantCorrection,
  resubmitApplicantApplication,
  resetSnapshot,
  reopenReviewerDecision,
  runAdminBenchmark,
  setActiveApplication,
  setProcessingMode,
  submitApplicantApplication,
  updateAdminSettings,
  updateFieldDecision,
  updateJobOperation,
  updateReviewNotes,
  updateWorkerOperation,
  unarchiveApplicantApplication,
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
    throw new Error(`Create is not supported for ${resource} in Browser Only mode.`);
  },
  update: async ({ resource, id, variables }) => {
    if (resource === "applications") {
      const existing = getSnapshot().applications.find((application) => application.id === String(id));
      if (!existing) throw new Error(`Application ${id} was not found.`);
      const snapshot = upsertApplication({ ...existing, ...(variables as any), updatedAt: new Date().toISOString() });
      return { data: snapshot.applications.find((application) => application.id === String(id)) as any };
    }
    throw new Error(`Update is not supported for ${resource} in Browser Only mode.`);
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
    if (action === "reviews/auto") {
      if (import.meta.env.MODE === "test") return { data: autoReviewApplication((payload as any).applicationId, (payload as any).mode) as any };
      return {
        data: (await autoReviewApplicationWithBrowserOcr((payload as any).applicationId, (payload as any).mode, {
          workerOverride: (payload as any).workerOverride
        })) as any
      };
    }
    if (action === "reviews/accept-auto") return { data: acceptAutoReview((payload as any).applicationId) as any };
    if (action === "reviews/finalize") return { data: finalizeReviewerDecision(payload as any) as any };
    if (action === "reviews/reopen") return { data: reopenReviewerDecision((payload as any).applicationId) as any };
    if (action === "reviews/batch-process") return { data: processReviewerBatch(payload as any) as any };
    if (action === "reviews/field") return { data: updateFieldDecision(payload as any) as any };
    if (action === "reviews/notes") return { data: updateReviewNotes(payload as any) as any };
    if (action === "applications/manual") return { data: addManualUpload(payload as any) as any };
    if (action === "applications/draft") return { data: createApplicantDraft(payload as any) as any };
    if (action === "applications/autosave-draft") return { data: autosaveApplicantDraft(payload as any) as any };
    if (action === "applications/delete-draft") return { data: deleteApplicantDraft((payload as any).applicationId) as any };
    if (action === "applications/submit") return { data: submitApplicantApplication((payload as any).applicationId) as any };
    if (action === "applications/resubmit") return { data: resubmitApplicantApplication(payload as any) as any };
    if (action === "applications/withdraw") return { data: withdrawApplicantApplication((payload as any).applicationId) as any };
    if (action === "applications/archive") return { data: archiveApplicantApplication((payload as any).applicationId) as any };
    if (action === "applications/unarchive") return { data: unarchiveApplicantApplication((payload as any).applicationId) as any };
    if (action === "corrections/request") return { data: requestApplicantCorrection(payload as any) as any };
    if (action === "admin/settings") return { data: updateAdminSettings(payload as any) as any };
    if (action === "admin/worker") return { data: updateWorkerOperation(payload as any) as any };
    if (action === "admin/job") return { data: updateJobOperation(payload as any) as any };
    if (action === "admin/benchmark") return { data: runAdminBenchmark(payload as any) as any };
    if (action === "admin/purge-raw-images") return { data: purgeRawImages() as any };
    if (action === "admin/purge-old-jobs") return { data: purgeOldJobs() as any };
    if (action === "admin/delete-packet") return { data: deleteApplicationPacket((payload as any).applicationId) as any };
    if (action === "admin/purge-all") return { data: purgeAllDemoData() as any };
    throw new Error(`Browser data action ${action} is not supported by the active provider.`);
  }
};

function resourceData(resource: string): any[] {
  return snapshotResourceData(resource, getSnapshot());
}
