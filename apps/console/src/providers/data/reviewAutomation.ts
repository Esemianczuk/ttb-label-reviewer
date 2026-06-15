import type { DataProvider } from "@refinedev/core";
import type { BrowserReviewProgressEvent } from "../../domain/application/browserOcrReview";
import type { ConsoleSnapshot, ProcessingMode } from "../../domain/application/types";
import { applyBackendReviewResult, autoReviewApplicationWithBrowserOcr } from "./browserStore";

type ReviewAutomationOptions = {
  dataProvider?: DataProvider;
  backendUnavailable?: boolean;
  workerOverride?: string;
  onProgress?: (message: string) => void;
  onProgressEvent?: (event: BrowserReviewProgressEvent) => void | Promise<void>;
};

export function backendReviewPayload(applicationId: string, mode: ProcessingMode) {
  return {
    applicationId,
    mode,
    primaryEngine: "paddleocr",
    ocrStrategy: "paddleocr_authoritative",
    targetLatencyMs: 5000,
    forceFreshOcr: true
  };
}

export async function runAutomatedReviewForMode(
  applicationId: string,
  mode: ProcessingMode,
  options: ReviewAutomationOptions = {}
): Promise<ConsoleSnapshot> {
  if (mode === "browser") {
    return autoReviewApplicationWithBrowserOcr(applicationId, mode, {
      workerOverride: options.workerOverride,
      onProgress: options.onProgress,
      onProgressEvent: options.onProgressEvent
    });
  }

  if (options.backendUnavailable) {
    throw new Error("Backend review is selected, but the FastAPI coordinator is offline. Start the backend or let the console use browser fallback.");
  }
  if (!options.dataProvider?.custom) {
    throw new Error("Backend review automation is not available from the active data provider.");
  }

  const response = await options.dataProvider.custom({
    url: "reviews/auto",
    method: "post",
    payload: backendReviewPayload(applicationId, mode)
  });

  return applyBackendReviewResult(applicationId, response.data);
}
