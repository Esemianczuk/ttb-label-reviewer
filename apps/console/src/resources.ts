import type { IResourceItem } from "@refinedev/core";

export const consoleResourceNames = [
  "applications",
  "applicationVersions",
  "labelAssets",
  "reviews",
  "reviewDecisions",
  "correctionRequests",
  "users",
  "workers",
  "jobs",
  "auditEvents",
  "settings",
  "reports",
  "fixtures",
  "benchmarks",
  "ocrModelStatus"
] as const;

export type ConsoleResourceName = (typeof consoleResourceNames)[number];

export const resourceLabels: Record<ConsoleResourceName, string> = {
  applications: "Applications",
  applicationVersions: "Application Versions",
  labelAssets: "Label Assets",
  reviews: "Reviews",
  reviewDecisions: "Review Decisions",
  correctionRequests: "Correction Requests",
  users: "Users",
  workers: "Workers",
  jobs: "Jobs",
  auditEvents: "Audit Events",
  settings: "Settings",
  reports: "Reports",
  fixtures: "Fixtures",
  benchmarks: "Benchmarks",
  ocrModelStatus: "OCR Model Status"
};

export const consoleResources: IResourceItem[] = consoleResourceNames.map((name) => ({
  name,
  list: `/resources/${name}`,
  show: `/resources/${name}/:id`,
  meta: {
    label: resourceLabels[name]
  }
}));

export function isConsoleResourceName(value: string | undefined): value is ConsoleResourceName {
  return Boolean(value && (consoleResourceNames as readonly string[]).includes(value));
}
