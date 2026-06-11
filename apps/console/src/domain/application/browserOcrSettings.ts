import { resolveBrowserOcrWorkerCount } from "./browserOcrReview";

export type BrowserOcrWorkerOverride = "auto" | "1" | "2" | "3";

const STORAGE_KEY = "ttb-console-browser-ocr-worker-override";
const allowedOverrides = new Set<BrowserOcrWorkerOverride>(["auto", "1", "2", "3"]);

export function getBrowserOcrWorkerOverride(): BrowserOcrWorkerOverride {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY) as BrowserOcrWorkerOverride | null;
    return value && allowedOverrides.has(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

export function setBrowserOcrWorkerOverride(value: string): BrowserOcrWorkerOverride {
  const normalized = allowedOverrides.has(value as BrowserOcrWorkerOverride) ? (value as BrowserOcrWorkerOverride) : "auto";
  try {
    window.localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // Worker preference is nice to keep, but not required for offline review.
  }
  return normalized;
}

export function browserOcrWorkerCountLabel(imageCount: number, override: string): string {
  const count = resolveBrowserOcrWorkerCount(imageCount, override);
  return `${count} browser OCR worker${count === 1 ? "" : "s"}`;
}
