import type {
  AdminJob,
  AdminSettings,
  AuditEvent,
  BenchmarkRun,
  ConsoleSnapshot,
  ExpectedFields,
  FieldStatus,
  LabelImage,
  ProcessingMode,
  ReviewApplication,
  ReviewField,
  ReviewResult,
  ReviewStatus,
  Severity,
  WorkerSnapshot
} from "./types";
import { estimatedCropForField } from "./evidenceCrops";
import { createApplicationNumber } from "./applicationNumber";
import { realColaFixtureSeeds, type FixtureSeed } from "./realColaFixtures";

const NOW = "2026-06-10T19:45:00.000Z";

const warningText =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

const seeds: FixtureSeed[] = realColaFixtureSeeds;

export const fieldOrder: Array<keyof ExpectedFields | "governmentWarning"> = [
  "brandName",
  "fancifulName",
  "classType",
  "alcoholContent",
  "netContents",
  "governmentWarning",
  "producerName",
  "countryOfOrigin"
];

export const fieldLabels: Record<string, string> = {
  productType: "Product Type",
  brandName: "Brand Name",
  fancifulName: "Fanciful Name",
  classType: "Class / Type",
  alcoholContent: "Alcohol Content",
  netContents: "Net Contents",
  governmentWarning: "Government Warning",
  producerName: "Producer / Bottler / Importer",
  countryOfOrigin: "Country Of Origin",
  applicationId: "Application ID",
  labelId: "Label ID"
};

export function createDemoSnapshot(): ConsoleSnapshot {
  const applications = seeds.map((seed, index) => createApplicationFromSeed(seed, index));
  return {
    applications,
    workers: createDemoWorkers(),
    jobs: createAdminJobsForApplications(applications),
    adminSettings: createDefaultAdminSettings(),
    benchmarkRuns: createDemoBenchmarkRuns(),
    auditEvents: [
      createAudit("audit-001", "System", "admin", "demo.reset", "applications", "Demo queue initialized from bundled public COLA registry records."),
      createAudit("audit-002", "Review Agent", "reviewer", "queue.ready", "reviews", "First application is ready for automatic review.")
    ],
    activeApplicationId: applications[0]?.id || "",
    processingMode: "browser"
  };
}

export function createDefaultAdminSettings(): AdminSettings {
  return {
    preferredOcrEngine: "browser-fixture",
    browserOcrAllowed: true,
    backendCpuOcrAllowed: true,
    gpuOcrAllowed: false,
    distributedWorkersAllowed: true,
    maxConcurrency: 4,
    validatorThreshold: 0.86,
    warningStrictness: "standard",
    retentionRawImagesDays: 30,
    retentionJobsDays: 14,
    keepReportsOnly: false
  };
}

export function createApplicationFromSeed(seed: FixtureSeed, index = 0): ReviewApplication {
  return {
    id: `app-${seed.id}`,
    title: seed.title,
    source: seed.source,
    status: seed.initialStatus || "SUBMITTED",
    expectedOutcome: seed.expectedOutcome,
    expectedFields: seed.expected,
    images: seed.images,
    submitter: seed.submitter || (index % 2 === 0 ? "Public COLA Registry" : "Imported COLA Applicant"),
    assignedTo: "Review Agent",
    createdAt: new Date(Date.parse(NOW) + index * 62_000).toISOString(),
    updatedAt: new Date(Date.parse(NOW) + index * 62_000).toISOString(),
    metadata: {
      ...seed.metadata,
      applicationNumber: createApplicationNumber(index + 1),
      description: seed.metadata.description || seed.description,
      fixtureId: seed.metadata.fixtureId || seed.id
    }
  };
}

export function createReviewForApplication(application: ReviewApplication, mode: ProcessingMode): ReviewResult {
  const seed = seeds.find((candidate) => `app-${candidate.id}` === application.id);
  const fields = createReviewFields(application, seed);
  const hasFail = fields.some((field) => effectiveStatus(field) === "FAIL");
  const hasNeedsReview = fields.some((field) => effectiveStatus(field) === "NEEDS_REVIEW");
  const status: ReviewStatus = hasFail ? "FAIL" : hasNeedsReview ? "NEEDS_REVIEW" : "PASS";
  const now = new Date().toISOString();

  return {
    id: `review-${application.id}-${Date.now()}`,
    applicationId: application.id,
    mode,
    status,
    startedAt: now,
    completedAt: now,
    fields,
    summary:
      status === "PASS"
        ? "All required application values matched the detected label evidence."
        : status === "FAIL"
          ? "One or more required TTB fields conflict with detected evidence."
          : "The automated review found low-confidence evidence requiring an agent decision.",
    rawOcrText: createDemoRawOcrText(application, fields),
    engineTrace: [
      mode === "browser" ? "Browser fixture OCR" : mode === "backend" ? "FastAPI coordinator review" : "Distributed worker validation",
      "Deterministic field normalizers",
      "Field-level evidence scorer",
      "Reviewer override audit layer"
    ]
  };
}

export function createManualApplication(input: {
  expectedFields: ExpectedFields;
  image: LabelImage;
  submitter?: string;
  notes?: string;
}): ReviewApplication {
  return createApplicantApplication({
    expectedFields: input.expectedFields,
    images: [input.image],
    submitter: input.submitter,
    notes: input.notes,
    description: "Manual one-image application created in the Refine console."
  });
}

export function createApplicantApplication(input: {
  expectedFields: ExpectedFields;
  images: LabelImage[];
  submitter?: string;
  notes?: string;
  description?: string;
}): ReviewApplication {
  const id = `app-manual-${Date.now()}`;
  const now = new Date().toISOString();
  return {
    id,
    title: input.expectedFields.brandName ? `${input.expectedFields.brandName} application` : "Draft label application",
    source: "upload",
    status: "DRAFT",
    expectedOutcome: "NEEDS_REVIEW",
    expectedFields: input.expectedFields,
    images: input.images,
    submitter: input.submitter || "Applicant",
    assignedTo: "Review Agent",
    createdAt: now,
    updatedAt: now,
    metadata: {
      description: input.description || "Applicant-created multi-image label packet.",
      notes: input.notes
    }
  };
}

export function createAudit(
  id: string,
  actor: string,
  role: AuditEvent["role"],
  action: string,
  resource: string,
  summary: string,
  metadata?: Record<string, unknown>
): AuditEvent {
  return {
    id,
    createdAt: new Date().toISOString(),
    actor,
    role,
    action,
    resource,
    summary,
    metadata
  };
}

function createReviewFields(application: ReviewApplication, seed?: FixtureSeed): ReviewField[] {
  return reviewFieldsForApplication(application)
    .map((fieldKey) => {
      const expected = fieldKey === "governmentWarning" ? warningText : String(application.expectedFields[fieldKey] || "");
      const extracted = seed?.extracted?.[fieldKey] || expected;
      const override = seed?.forcedFailures?.[fieldKey];
      const status: FieldStatus = override?.status || "PASS";
      const severity: Severity = override?.severity || (status === "PASS" ? "info" : "warning");
      return {
        id: `${application.id}-${fieldKey}`,
        fieldKey,
        label: fieldLabels[fieldKey],
        expected,
        extracted,
        status,
        severity,
        confidence: status === "PASS" ? 0.98 : status === "FAIL" ? 0.91 : 0.64,
        reason:
          override?.reason ||
          `The detected ${fieldLabels[fieldKey].toLowerCase()} evidence matches the expected application value after normalization.`,
        evidence: [
          {
            sourceImageId: application.images[0]?.id || "",
            excerpt: extracted.length > 180 ? `${extracted.slice(0, 177)}...` : extracted,
            confidence: status === "PASS" ? 0.98 : status === "FAIL" ? 0.91 : 0.64,
            pageAnchor: "COLA sheet",
            crop: estimatedCropForField(fieldKey)
          }
        ]
      };
    });
}

function reviewFieldsForApplication(application: ReviewApplication): Array<keyof ExpectedFields | "governmentWarning"> {
  const required: Array<keyof ExpectedFields | "governmentWarning"> = ["brandName", "classType", "alcoholContent", "netContents", "governmentWarning"];
  const optional = fieldOrder.filter((fieldKey) => fieldKey !== "governmentWarning" && application.expectedFields[fieldKey]);
  return Array.from(new Set([...required, ...optional]));
}

function createDemoRawOcrText(application: ReviewApplication, fields: ReviewField[]): string {
  const image = application.images[0];
  return [
    `Image: ${image?.name || "Demo label image"}`,
    `Role: ${image?.role?.replace("_", " ") || "label image"}`,
    "",
    ...fields.map((field) => `${field.label}: ${field.extracted || field.reason}`)
  ].join("\n");
}

function createDemoWorkers(): WorkerSnapshot[] {
  return [
    {
      id: "worker-local-browser",
      hostname: "browser-session",
      platform: "Chromium",
      os: "Browser",
      arch: "wasm",
      cpu: "Navigator worker pool",
      ramGb: 0,
      gpu: "WebGL/WebGPU if available",
      status: "online",
      activeJobs: 1,
      maxConcurrency: 2,
      capabilities: ["browser_ocr", "validation", "pdf_export"],
      engines: ["browser-fixture", "tesseract-js"],
      latencyMs: 0,
      throughput: "local",
      avgMsPerImage: 720,
      lastSeenAt: new Date().toISOString()
    },
    {
      id: "worker-fastapi-01",
      hostname: "bigbertha.sherpa-map.internal",
      platform: "Linux x64",
      os: "Linux",
      arch: "x64",
      cpu: "16 vCPU",
      ramGb: 64,
      gpu: "CUDA unavailable",
      status: "busy",
      activeJobs: 2,
      maxConcurrency: 4,
      capabilities: ["ocr", "evidence_crop", "validation"],
      engines: ["tesseract", "null-engine"],
      latencyMs: 18,
      throughput: "24 pages/min",
      avgMsPerImage: 410,
      lastSeenAt: new Date(Date.now() - 9_000).toISOString()
    },
    {
      id: "worker-mac-01",
      hostname: "mac",
      platform: "macOS arm64",
      os: "macOS",
      arch: "arm64",
      cpu: "Apple Silicon",
      ramGb: 16,
      gpu: "MPS available",
      status: "online",
      activeJobs: 0,
      maxConcurrency: 2,
      capabilities: ["ocr", "evidence_crop"],
      engines: ["tesseract", "vision-precheck"],
      latencyMs: 26,
      throughput: "11 pages/min",
      avgMsPerImage: 580,
      lastSeenAt: new Date(Date.now() - 22_000).toISOString()
    }
  ];
}

export function createAdminJobsForApplications(applications: ReviewApplication[]): AdminJob[] {
  const now = Date.now();
  return applications.flatMap((application, index) => {
    const workerId = index % 2 === 0 ? "worker-fastapi-01" : "worker-local-browser";
    const base = {
      applicationId: application.id,
      workerId,
      engine: workerId === "worker-local-browser" ? "browser-fixture" : "tesseract",
      attempts: index === 2 ? 2 : 1,
      createdAt: new Date(now - (index + 3) * 60_000).toISOString(),
      schedulerReason: index % 2 === 0 ? "Warm OCR engine and low active job count." : "Browser-only session affinity."
    };
    return [
      {
        ...base,
        id: `job-${application.id}-ocr`,
        type: "ocr" as const,
        status: index === 2 ? "failed" as const : index === 3 ? "running" as const : "completed" as const,
        priority: 100 - index * 6,
        startedAt: new Date(now - (index + 2) * 60_000).toISOString(),
        completedAt: index === 3 ? undefined : new Date(now - (index + 1) * 60_000).toISOString(),
        durationMs: index === 3 ? undefined : 540 + index * 90
      },
      {
        ...base,
        id: `job-${application.id}-validation`,
        type: "validation" as const,
        status: index < 2 ? "completed" as const : "queued" as const,
        priority: 90 - index * 5,
        createdAt: new Date(now - (index + 2) * 45_000).toISOString(),
        startedAt: index < 2 ? new Date(now - (index + 1) * 45_000).toISOString() : undefined,
        completedAt: index < 2 ? new Date(now - index * 45_000).toISOString() : undefined,
        durationMs: index < 2 ? 180 + index * 32 : undefined
      }
    ];
  });
}

export function createDemoBenchmarkRuns(): BenchmarkRun[] {
  const now = Date.now();
  return [
    {
      id: "benchmark-quick-browser",
      label: "Quick browser smoke",
      imageCount: 10,
      mode: "browser",
      workerId: "worker-local-browser",
      averageMsPerImage: 720,
      p50OcrMs: 690,
      p95OcrMs: 980,
      imagesPerMinute: 83,
      createdAt: new Date(now - 35 * 60_000).toISOString()
    },
    {
      id: "benchmark-fastapi-cpu",
      label: "FastAPI CPU batch",
      imageCount: 50,
      mode: "backend",
      workerId: "worker-fastapi-01",
      averageMsPerImage: 410,
      p50OcrMs: 390,
      p95OcrMs: 760,
      imagesPerMinute: 146,
      createdAt: new Date(now - 3 * 60 * 60_000).toISOString()
    }
  ];
}

function effectiveStatus(field: ReviewField): FieldStatus {
  return field.reviewerStatus || field.status;
}
