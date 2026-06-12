import type { ExpectedFields, FieldStatus, LabelImage, ReviewApplication, Severity } from "./types";
import { createApplicationNumber } from "./applicationNumber";

const expectedModules = import.meta.glob("../../../../../fixtures/public-cola-registry/records/*/expected.json", {
  eager: true,
  import: "default"
}) as Record<string, PublicExpectedRecord>;

const metadataModules = import.meta.glob("../../../../../fixtures/public-cola-registry/records/*/metadata.json", {
  eager: true,
  import: "default"
}) as Record<string, PublicMetadataRecord>;

const imageModules = import.meta.glob("../../../../../fixtures/public-cola-registry/records/*/assets/*.{jpg,jpeg,png,JPG,JPEG,PNG}", {
  eager: true,
  import: "default",
  query: "?url"
}) as Record<string, string>;

type PublicExpectedRecord = {
  fixture_id?: string;
  source_type?: string;
  ttb_id?: string;
  expected_fields?: {
    brandName?: string | null;
    fancifulName?: string | null;
    classType?: string | null;
    productType?: string | null;
    alcoholContent?: string | null;
    netContents?: string | null;
    governmentWarningRequired?: boolean | null;
    isImported?: boolean | null;
    countryOfOrigin?: string | null;
    responsibleParty?: { name?: string | null; address?: string | null } | null;
  };
  assets?: Array<{ file?: string; role?: string }>;
  known_limitations?: string[];
  demo_ready?: boolean;
  demo_audit?: { status?: string; source?: string; reason?: string; note?: string; reviewed_common_fields?: string[] };
};

type PublicMetadataRecord = {
  source?: { detail_url?: string; retrieved_at?: string };
  ttb_id?: string;
  status?: string;
  approval_date?: string | null;
  serial_number?: string | null;
  applicant_name?: string | null;
  applicant_address?: string | null;
  application?: {
    brand_name?: string | null;
    fanciful_name?: string | null;
    class_type?: string | null;
    product_type?: string | null;
    alcohol_content?: string | null;
    net_contents?: string | null;
    origin?: string | null;
    permit_number?: string | null;
    applicant_name?: string | null;
    applicant_address?: string | null;
  };
  assets?: Array<{
    kind?: string;
    local_path?: string;
    content_type?: string;
    bytes?: number;
    url?: string;
  }>;
  raw_fields?: Array<{ label?: string; value?: string | null }>;
};

export type FixtureSeed = {
  id: string;
  title: string;
  description: string;
  source: ReviewApplication["source"];
  expectedOutcome: ReviewApplication["expectedOutcome"];
  expected: ExpectedFields;
  images: LabelImage[];
  extracted?: Partial<Record<keyof ExpectedFields | "governmentWarning", string>>;
  forcedFailures?: Partial<Record<keyof ExpectedFields | "governmentWarning", { status: FieldStatus; reason: string; severity?: Severity }>>;
  initialStatus?: ReviewApplication["status"];
  submitter?: string;
  metadata: ReviewApplication["metadata"];
};

const correctionRecordId = "19350001000429";

export const realColaFixtureSeeds: FixtureSeed[] = Object.entries(expectedModules)
  .map(([path, expected]) => {
    if (expected.demo_ready === false) return null;
    const recordId = recordIdFromPath(path);
    if (!recordId) return null;
    const metadata = metadataForRecord(recordId);
    if (!metadata) return null;
    return createSeed(recordId, expected, metadata);
  })
  .filter((seed): seed is FixtureSeed => Boolean(seed))
  .sort((a, b) => String(a.metadata.ttbId || a.id).localeCompare(String(b.metadata.ttbId || b.id)));

function createSeed(recordId: string, expectedRecord: PublicExpectedRecord, metadata: PublicMetadataRecord): FixtureSeed {
  const raw = rawFieldMap(metadata);
  const expectedFields = expectedRecord.expected_fields || {};
  const application = metadata.application || {};
  const isImported = expectedFields.isImported === true;
  const productType = normalizeProductType(
    firstValue(expectedFields.productType, application.product_type, raw.get("product type"), inferProductType(firstValue(expectedFields.classType, application.class_type, raw.get("class/type code"))))
  );
  const expected: ExpectedFields = {
    productType,
    brandName: firstValue(expectedFields.brandName, application.brand_name, raw.get("brand name")),
    fancifulName: firstValue(expectedFields.fancifulName, application.fanciful_name, raw.get("fanciful name")) || undefined,
    classType: firstValue(expectedFields.classType, application.class_type, raw.get("class/type code")),
    alcoholContent: firstValue(expectedFields.alcoholContent, application.alcohol_content, raw.get("alcohol content")),
    netContents: firstValue(expectedFields.netContents, application.net_contents, raw.get("net contents")),
    governmentWarningRequired: expectedFields.governmentWarningRequired ?? true,
    producerName: firstValue(expectedFields.responsibleParty?.name, application.applicant_name, metadata.applicant_name, raw.get("applicant name")) || undefined,
    countryOfOrigin: isImported ? firstValue(expectedFields.countryOfOrigin) || undefined : undefined,
    applicationId: metadata.ttb_id || recordId,
    labelId: metadata.serial_number || raw.get("serial #") || recordId
  };
  const missingRequired = requiredMissingFields(expected, isImported);
  const forcedFailures = Object.fromEntries(
    missingRequired.map((field) => [
      field,
      {
        status: "NEEDS_REVIEW" as FieldStatus,
        severity: "critical" as Severity,
        reason: `${fieldLabel(field)} was not present in the public COLA metadata. The applicant should complete it or the reviewer should verify it directly from the label image.`
      }
    ])
  ) as FixtureSeed["forcedFailures"];
  const extracted = Object.fromEntries(missingRequired.map((field) => [field, "Not supplied in public registry metadata."])) as FixtureSeed["extracted"];
  const title = `${expected.brandName || "Public COLA"} ${expected.classType || "label"} record`;
  const startsInCorrection = recordId === correctionRecordId;
  const auditNote = expectedRecord.demo_audit?.status
    ? `Demo audit: ${expectedRecord.demo_audit.status}${expectedRecord.demo_audit.source ? ` from ${expectedRecord.demo_audit.source}` : ""}.`
    : "";
  return {
    id: `ttb-${recordId}`,
    title,
    description: `Real public COLA registry record ${recordId}${metadata.approval_date ? ` approved ${metadata.approval_date}` : ""}.`,
    source: "public_cola_registry",
    expectedOutcome: missingRequired.length ? "NEEDS_REVIEW" : "PASS",
    expected,
    extracted,
    forcedFailures,
    initialStatus: startsInCorrection ? "NEEDS_CORRECTION" : "SUBMITTED",
    submitter: expected.producerName || metadata.applicant_name || "Public COLA registry applicant",
    images: labelImagesForRecord(recordId, metadata),
    metadata: {
      description: `Imported from the official public COLA registry fixture set. ${missingRequired.length ? `Missing fields: ${missingRequired.map(fieldLabel).join(", ")}.` : "Core public metadata parsed successfully."}`,
      ttbId: metadata.ttb_id || recordId,
      publicRegistryUrl: metadata.source?.detail_url,
      fixtureId: expectedRecord.fixture_id || `ttb_${recordId}`,
      packetPath: `fixtures/public-cola-registry/records/${recordId}`,
      demoReady: expectedRecord.demo_ready !== false,
      demoAudit: expectedRecord.demo_audit,
      notes: [
        metadata.status ? `Registry status: ${metadata.status}.` : "",
        metadata.approval_date ? `Approval date: ${metadata.approval_date}.` : "",
        auditNote,
        ...(expectedRecord.known_limitations || [])
      ].filter(Boolean).join(" "),
      correctionMessage: startsInCorrection ? "Reviewer requested a cleaner applicant confirmation of the alcohol content and net contents shown on the retained public label image." : undefined,
      correctionFields: startsInCorrection ? ["alcoholContent", "netContents"] : undefined
    }
  };
}

function labelImagesForRecord(recordId: string, metadata: PublicMetadataRecord): LabelImage[] {
  const labelAssets = (metadata.assets || []).filter((asset) => asset.kind === "label_image" && asset.local_path);
  return labelAssets
    .map((asset, index) => {
      const url = imageUrlForRecordAsset(recordId, asset.local_path || "");
      const name = asset.local_path?.split("/").pop() || `label_${String(index + 1).padStart(2, "0")}.jpg`;
      return {
        id: `ttb-${recordId}-image-${index + 1}`,
        role: roleFromImageName(name, index),
        name,
        url,
        mimeType: asset.content_type || "image/jpeg",
        sizeBytes: asset.bytes,
        source: "api" as const
      };
    })
    .filter((image) => Boolean(image.url));
}

function imageUrlForRecordAsset(recordId: string, localPath: string): string {
  const match = Object.entries(imageModules).find(([path]) => path.includes(`/records/${recordId}/${localPath}`));
  return match?.[1] || "";
}

function roleFromImageName(name: string, index: number): LabelImage["role"] {
  const lower = name.toLowerCase();
  if (lower.includes("front")) return "front";
  if (lower.includes("back")) return "back";
  if (lower.includes("neck")) return "neck";
  if (lower.includes("carton")) return "carton";
  if (index === 0) return "front";
  if (index === 1) return "back";
  return "other";
}

function metadataForRecord(recordId: string): PublicMetadataRecord | undefined {
  return Object.entries(metadataModules).find(([path]) => path.includes(`/records/${recordId}/metadata.json`))?.[1];
}

function recordIdFromPath(path: string): string | null {
  return path.match(/\/records\/([^/]+)\/expected\.json$/)?.[1] || null;
}

function rawFieldMap(metadata: PublicMetadataRecord): Map<string, string> {
  return new Map((metadata.raw_fields || []).map((field) => [String(field.label || "").trim().toLowerCase(), String(field.value || "").trim()]));
}

function firstValue(...values: Array<string | null | undefined>): string {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function normalizeProductType(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes("wine")) return "wine";
  if (lower.includes("malt") || lower.includes("beer") || lower.includes("ale") || lower.includes("stout")) return "malt_beverage";
  if (lower.includes("spirit") || lower.includes("vodka") || lower.includes("tequila") || lower.includes("rum") || lower.includes("whisk")) return "distilled_spirits";
  return value || "unknown";
}

function inferProductType(classType: string): string {
  return normalizeProductType(classType);
}

function requiredMissingFields(fields: ExpectedFields, isImported: boolean): Array<keyof ExpectedFields> {
  const required: Array<keyof ExpectedFields> = ["brandName", "classType", "alcoholContent", "netContents", "producerName"];
  if (isImported) required.push("countryOfOrigin");
  return required.filter((field) => !String(fields[field] || "").trim());
}

function fieldLabel(field: keyof ExpectedFields | "governmentWarning"): string {
  const labels: Record<string, string> = {
    brandName: "Brand name",
    classType: "Class/type",
    alcoholContent: "Alcohol content",
    netContents: "Net contents",
    producerName: "Producer / bottler / importer",
    countryOfOrigin: "Country of origin",
    governmentWarning: "Government warning"
  };
  return labels[field] || field;
}
