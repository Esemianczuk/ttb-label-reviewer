import type {
  AuditEvent,
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

const NOW = "2026-06-10T19:45:00.000Z";

type FixtureSeed = {
  id: string;
  title: string;
  description: string;
  imagePath: string;
  expectedOutcome: ReviewApplication["expectedOutcome"];
  expected: ExpectedFields;
  extracted?: Partial<Record<keyof ExpectedFields | "governmentWarning", string>>;
  forcedFailures?: Partial<Record<keyof ExpectedFields | "governmentWarning", { status: FieldStatus; reason: string; severity?: Severity }>>;
};

const warningText =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

const seeds: FixtureSeed[] = [
  {
    id: "hollow-ridge-bourbon",
    title: "Hollow Ridge bourbon COLA sheet",
    description: "One-image synthetic COLA sheet with complete bourbon application data.",
    imagePath: "/label-packets/hollow-ridge-bourbon/cola-sheet.png",
    expectedOutcome: "PASS",
    expected: {
      productType: "distilled_spirits",
      brandName: "HOLLOW RIDGE",
      classType: "Kentucky Straight Bourbon Whiskey",
      alcoholContent: "45% Alc./Vol. (90 Proof)",
      netContents: "750 mL",
      governmentWarningRequired: true,
      producerName: "Hollow Ridge Distilling Co.",
      countryOfOrigin: "United States",
      applicationId: "SAMPLE-HOLLOW-RIDGE",
      labelId: "hollow-ridge-bourbon-cola-sheet.png"
    }
  },
  {
    id: "highland-coast-lightkeeper-gin",
    title: "Highland Coast Lightkeeper Gin COLA sheet",
    description: "Clean gin submission with strong brand, class, ABV, and warning evidence.",
    imagePath: "/label-packets/highland-coast-lightkeeper-gin/cola-sheet.png",
    expectedOutcome: "PASS",
    expected: {
      productType: "distilled_spirits",
      brandName: "HIGHLAND COAST",
      fancifulName: "Lightkeeper Gin",
      classType: "Distilled Gin",
      alcoholContent: "43% Alc./Vol.",
      netContents: "750 mL",
      governmentWarningRequired: true,
      producerName: "Highland Coast Spirits",
      countryOfOrigin: "United States",
      applicationId: "SAMPLE-LIGHTKEEPER",
      labelId: "highland-coast-lightkeeper-gin-cola-sheet.png"
    }
  },
  {
    id: "riverlight-rye-whiskey",
    title: "Riverlight rye whiskey COLA sheet",
    description: "Rye whiskey application with an alcohol-content mismatch for reviewer correction.",
    imagePath: "/label-packets/riverlight-rye-whiskey/cola-sheet.png",
    expectedOutcome: "FAIL",
    expected: {
      productType: "distilled_spirits",
      brandName: "RIVERLIGHT",
      classType: "Straight Rye Whiskey",
      alcoholContent: "47% Alc./Vol. (94 Proof)",
      netContents: "750 mL",
      governmentWarningRequired: true,
      producerName: "Riverlight Spirits",
      countryOfOrigin: "United States",
      applicationId: "SAMPLE-RIVERLIGHT-RYE",
      labelId: "riverlight-rye-whiskey-cola-sheet.png"
    },
    extracted: {
      alcoholContent: "45% Alc./Vol. (90 Proof)"
    },
    forcedFailures: {
      alcoholContent: {
        status: "FAIL",
        severity: "critical",
        reason: "The label evidence reads 45% Alc./Vol. while the expected application value is 47% Alc./Vol."
      }
    }
  },
  {
    id: "sundaze-hard-seltzer",
    title: "Sundaze hard seltzer COLA sheet",
    description: "Hard seltzer packet where warning evidence needs human confirmation.",
    imagePath: "/label-packets/sundaze-hard-seltzer/cola-sheet.png",
    expectedOutcome: "NEEDS_REVIEW",
    expected: {
      productType: "malt_beverage",
      brandName: "SUNDAZE",
      fancifulName: "Hard Seltzer Variety Pack",
      classType: "Flavored Malt Beverage",
      alcoholContent: "5% Alc./Vol.",
      netContents: "12 fl oz",
      governmentWarningRequired: true,
      producerName: "Sundaze Beverage Co.",
      countryOfOrigin: "United States",
      applicationId: "SAMPLE-SUNDAZE",
      labelId: "sundaze-hard-seltzer-cola-sheet.png"
    },
    extracted: {
      governmentWarning: "GOVERNMENT WARNING present but OCR confidence is low around line breaks."
    },
    forcedFailures: {
      governmentWarning: {
        status: "NEEDS_REVIEW",
        severity: "warning",
        reason: "The required government warning is probably present, but the detected line breaks and confidence need reviewer confirmation."
      }
    }
  },
  {
    id: "arbor-hill-cabernet-sauvignon",
    title: "Arbor Hill Cabernet Sauvignon COLA sheet",
    description: "Wine application with complete public-facing application fields.",
    imagePath: "/label-packets/arbor-hill-cabernet-sauvignon/cola-sheet.png",
    expectedOutcome: "PASS",
    expected: {
      productType: "wine",
      brandName: "ARBOR HILL",
      fancifulName: "Cabernet Sauvignon",
      classType: "Table Red Wine",
      alcoholContent: "13.8% Alc./Vol.",
      netContents: "750 mL",
      governmentWarningRequired: true,
      producerName: "Arbor Hill Winery",
      countryOfOrigin: "United States",
      applicationId: "SAMPLE-ARBOR-HILL",
      labelId: "arbor-hill-cabernet-sauvignon-cola-sheet.png"
    }
  },
  {
    id: "estrella-tequila-blanco",
    title: "Estrella Tequila Blanco COLA sheet",
    description: "Tequila application using the one-image COLA sheet path.",
    imagePath: "/label-packets/estrella-tequila-blanco/cola-sheet.png",
    expectedOutcome: "PASS",
    expected: {
      productType: "distilled_spirits",
      brandName: "ESTRELLA",
      fancifulName: "Tequila Blanco",
      classType: "Tequila",
      alcoholContent: "40% Alc./Vol. (80 Proof)",
      netContents: "750 mL",
      governmentWarningRequired: true,
      producerName: "Destiladora Estrella",
      countryOfOrigin: "Mexico",
      applicationId: "SAMPLE-ESTRELLA",
      labelId: "estrella-tequila-blanco-cola-sheet.png"
    }
  }
];

export const fieldOrder: Array<keyof ExpectedFields | "governmentWarning"> = [
  "brandName",
  "fancifulName",
  "classType",
  "alcoholContent",
  "netContents",
  "governmentWarning",
  "producerName",
  "countryOfOrigin",
  "applicationId",
  "labelId"
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
    auditEvents: [
      createAudit("audit-001", "System", "admin", "demo.reset", "applications", "Demo queue initialized from bundled sample packets."),
      createAudit("audit-002", "Review Agent", "reviewer", "queue.ready", "reviews", "First application is ready for automatic review.")
    ],
    activeApplicationId: applications[0]?.id || "",
    processingMode: "browser"
  };
}

export function createApplicationFromSeed(seed: FixtureSeed, index = 0): ReviewApplication {
  const image: LabelImage = {
    id: `${seed.id}-sheet`,
    role: "cola_sheet",
    name: seed.expected.labelId || `${seed.id}.png`,
    url: seed.imagePath,
    mimeType: "image/png",
    source: "sample"
  };

  return {
    id: `app-${seed.id}`,
    title: seed.title,
    source: "sample",
    status: index === 0 ? "SUBMITTED" : "DRAFT",
    expectedOutcome: seed.expectedOutcome,
    expectedFields: seed.expected,
    images: [image],
    submitter: index % 2 === 0 ? "Riverside Imports" : "Frontier Beverage Group",
    assignedTo: "Review Agent",
    createdAt: new Date(Date.parse(NOW) + index * 62_000).toISOString(),
    updatedAt: new Date(Date.parse(NOW) + index * 62_000).toISOString(),
    metadata: {
      description: seed.description,
      fixtureId: seed.id,
      packetPath: seed.imagePath
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
  const id = `app-manual-${Date.now()}`;
  const now = new Date().toISOString();
  return {
    id,
    title: input.expectedFields.brandName ? `${input.expectedFields.brandName} manual review` : "Manual label review",
    source: "upload",
    status: "READY_TO_SUBMIT",
    expectedOutcome: "NEEDS_REVIEW",
    expectedFields: input.expectedFields,
    images: [input.image],
    submitter: input.submitter || "Evaluator upload",
    assignedTo: "Review Agent",
    createdAt: now,
    updatedAt: now,
    metadata: {
      description: "Manual one-image application created in the Refine console.",
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
  return fieldOrder
    .filter((fieldKey) => fieldKey === "governmentWarning" || application.expectedFields[fieldKey])
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
            pageAnchor: "COLA sheet"
          }
        ]
      };
    });
}

function createDemoWorkers(): WorkerSnapshot[] {
  return [
    {
      id: "worker-local-browser",
      hostname: "browser-session",
      platform: "Chromium",
      status: "online",
      activeJobs: 1,
      maxConcurrency: 2,
      capabilities: ["browser_ocr", "validation", "pdf_export"],
      latencyMs: 0,
      throughput: "local",
      lastSeenAt: new Date().toISOString()
    },
    {
      id: "worker-fastapi-01",
      hostname: "bigbertha.sherpa-map.internal",
      platform: "Linux x64",
      status: "busy",
      activeJobs: 2,
      maxConcurrency: 4,
      capabilities: ["ocr", "evidence_crop", "validation"],
      latencyMs: 18,
      throughput: "24 pages/min",
      lastSeenAt: new Date(Date.now() - 9_000).toISOString()
    },
    {
      id: "worker-mac-01",
      hostname: "mac",
      platform: "macOS arm64",
      status: "online",
      activeJobs: 0,
      maxConcurrency: 2,
      capabilities: ["ocr", "evidence_crop"],
      latencyMs: 26,
      throughput: "11 pages/min",
      lastSeenAt: new Date(Date.now() - 22_000).toISOString()
    }
  ];
}

function effectiveStatus(field: ReviewField): FieldStatus {
  return field.reviewerStatus || field.status;
}
