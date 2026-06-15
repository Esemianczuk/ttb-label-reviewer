import type {
  AdminJob,
  AdminSettings,
  AuditEvent,
  BenchmarkRun,
  ConsoleSnapshot,
  ExpectedFields,
  FieldStatus,
  LabelImage,
  OcrModelStatus,
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
    ocrModelStatus: createDemoOcrModelStatus(),
    auditEvents: [
      createAudit("audit-001", "System", "admin", "demo.reset", "applications", "Demo queue initialized from bundled public COLA registry records."),
      createAudit("audit-002", "Review Agent", "reviewer", "queue.ready", "reviews", "First application is ready for automatic review.")
    ],
    activeApplicationId: applications[0]?.id || "",
    processingMode: "backend"
  };
}

export function createDemoOcrModelStatus(): OcrModelStatus[] {
  return [
    {
      id: "paddleocr-field-alignment",
      status: "active",
      trainedModelLoaded: false,
      mode: "paddleocr-weak-field-alignment",
      modelDir: null,
      message: "Backend review uses PaddleOCR full-image OCR, then aligns expected fields to OCR token spans for evidence crops.",
      modelCard: {
        name: "PaddleOCR full-image field alignment",
        runtimePolicy: "PaddleOCR recognition plus deterministic validators"
      },
      metrics: null,
      failureReport: null
    }
  ];
}

export function createDefaultAdminSettings(): AdminSettings {
  return {
    preferredOcrEngine: "paddleocr",
    browserOcrAllowed: true,
    backendCpuOcrAllowed: true,
    gpuOcrAllowed: false,
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
      mode === "browser" ? "Browser Tesseract OCR" : "FastAPI PaddleOCR COLA review with deterministic validators",
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
  return [];
}

export function createAdminJobsForApplications(applications: ReviewApplication[]): AdminJob[] {
  void applications;
  return [];
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
