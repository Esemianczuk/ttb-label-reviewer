import type { UploadFile } from "antd/es/upload/interface";
import type { ExpectedFields, LabelImage, ReviewApplication } from "../../domain/application/types";

export const IMAGE_ROLE_OPTIONS = [
  { value: "front", label: "Front" },
  { value: "back", label: "Back" },
  { value: "neck", label: "Neck" },
  { value: "carton", label: "Carton" },
  { value: "other", label: "Other" },
  { value: "cola_sheet", label: "COLA Sheet" }
] as const;

export type ImageRole = (typeof IMAGE_ROLE_OPTIONS)[number]["value"];

export type DraftUploadImage = {
  uid: string;
  file: File;
  role: ImageRole;
  url: string;
  width?: number;
  height?: number;
  warnings: string[];
};

export type ApplicantFormValues = ExpectedFields & {
  submitter?: string;
  notes?: string;
};

export type ApplicantDataImportResult = {
  sourceName: string;
  values: Partial<ApplicantFormValues>;
  detectedFields: Array<keyof ApplicantFormValues>;
  attentionFields: Array<keyof ApplicantFormValues>;
};

export const DEFAULT_APPLICANT_VALUES: Partial<ApplicantFormValues> = {
  productType: "distilled_spirits",
  governmentWarningRequired: true,
  submitter: ""
};

export const REQUIRED_APPLICANT_FIELDS: Array<keyof ApplicantFormValues> = ["brandName", "classType", "alcoholContent", "netContents"];

export function imageCountLabel(count: number): string {
  return `${count} label image${count === 1 ? "" : "s"}`;
}

export function toLabelImages(images: DraftUploadImage[]): LabelImage[] {
  return images.map((image, index) => ({
    id: `upload-${image.uid}-${index}`,
    role: image.role,
    name: image.file.name,
    url: image.url,
    mimeType: image.file.type || "image/png",
    sizeBytes: image.file.size,
    width: image.width,
    height: image.height,
    qualityWarnings: image.warnings,
    source: "upload"
  }));
}

export function expectedFieldsFromValues(values: ApplicantFormValues): ExpectedFields {
  return {
    productType: values.productType || "unknown",
    brandName: values.brandName || "",
    fancifulName: values.fancifulName,
    classType: values.classType || "",
    alcoholContent: values.alcoholContent || "",
    netContents: values.netContents || "",
    governmentWarningRequired: values.governmentWarningRequired ?? true,
    producerName: values.producerName,
    countryOfOrigin: values.countryOfOrigin,
    applicationId: values.applicationId,
    labelId: values.labelId
  };
}

export function readinessIssues(application: ReviewApplication): string[] {
  const issues: string[] = [];
  if (!application.images.length) issues.push("At least one label image is required.");
  for (const field of missingApplicantFields(application.expectedFields as ApplicantFormValues)) {
    issues.push(`${applicantFieldLabel(field)} is required.`);
  }
  for (const image of application.images) {
    for (const warning of image.qualityWarnings || []) {
      if (isBlockingImageWarning(warning)) issues.push(`${image.name}: ${warning}`);
    }
  }
  return issues;
}

export function missingApplicantFields(values: Partial<ApplicantFormValues>): Array<keyof ApplicantFormValues> {
  return REQUIRED_APPLICANT_FIELDS.filter((field) => !String(values[field] || "").trim());
}

export async function importApplicantDataFile(file: File): Promise<ApplicantDataImportResult> {
  const text = await readFileText(file);
  const values = valuesFromApplicantData(file.name, text);
  const detectedFields = Object.keys(values).filter((key) => String(values[key as keyof ApplicantFormValues] ?? "").trim()) as Array<keyof ApplicantFormValues>;
  return {
    sourceName: file.name,
    values,
    detectedFields,
    attentionFields: missingApplicantFields(values)
  };
}

export function valuesFromApplicantData(fileName: string, text: string): Partial<ApplicantFormValues> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (/\.json$/i.test(fileName) || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return valuesFromJson(JSON.parse(trimmed));
    } catch {
      return valuesFromLabelText(trimmed);
    }
  }
  if (/\.xml$/i.test(fileName) || /^<\?xml|^<[^>]+>/i.test(trimmed)) {
    return valuesFromStructuredText(trimmed);
  }
  return valuesFromLabelText(trimmed);
}

export async function draftImagesFromUploadFiles(files: UploadFile[], existing: DraftUploadImage[]): Promise<DraftUploadImage[]> {
  const existingByUid = new Map(existing.map((image) => [image.uid, image]));
  const next = await Promise.all(
    files.slice(0, 10).map(async (upload, index) => {
      const existingImage = existingByUid.get(upload.uid);
      if (existingImage) return existingImage;
      const file = upload.originFileObj;
      if (!file) throw new Error("Upload file is missing.");
      const url = URL.createObjectURL(file);
      const dimensions: { width?: number; height?: number } = await readImageDimensions(url).catch(() => ({}));
      const role = defaultRole(index);
      return {
        uid: upload.uid,
        file,
        role,
        url,
        ...dimensions,
        warnings: assessImage(file, dimensions.width, dimensions.height, role)
      };
    })
  );
  return next;
}

export function updateDraftImageRole(images: DraftUploadImage[], uid: string, role: ImageRole): DraftUploadImage[] {
  return images.map((image) =>
    image.uid === uid
      ? {
          ...image,
          role,
          warnings: assessImage(image.file, image.width, image.height, role)
        }
      : image
  );
}

function defaultRole(index: number): ImageRole {
  if (index === 0) return "front";
  if (index === 1) return "back";
  return "other";
}

function valuesFromJson(payload: any): Partial<ApplicantFormValues> {
  const rawFields = rawFieldMap(payload?.raw_fields);
  const expected = payload?.expected_fields || payload?.expectedFields || {};
  const application = payload?.application || payload?.applicationFields || {};
  const responsibleParty = expected?.responsibleParty || payload?.responsibleParty || {};
  const classType = firstValue(expected.classType, expected.class_type, application.classType, application.class_type, rawFields.get("class/type code"), rawFields.get("class/type"));
  const applicantName = firstValue(
    expected.producerName,
    expected.producer_name,
    responsibleParty.name,
    application.producerName,
    application.producer_name,
    application.applicant_name,
    payload?.applicant_name,
    rawFields.get("applicant name")
  );
  return compactValues({
    productType: normalizeProductType(firstValue(expected.productType, expected.product_type, application.productType, application.product_type, payload?.productType, inferProductType(classType))),
    brandName: firstValue(expected.brandName, expected.brand_name, application.brandName, application.brand_name, payload?.brandName, rawFields.get("brand name")),
    fancifulName: firstValue(expected.fancifulName, expected.fanciful_name, application.fancifulName, application.fanciful_name, rawFields.get("fanciful name")),
    classType,
    alcoholContent: firstValue(expected.alcoholContent, expected.alcohol_content, application.alcoholContent, application.alcohol_content, rawFields.get("alcohol content")),
    netContents: firstValue(expected.netContents, expected.net_contents, application.netContents, application.net_contents, rawFields.get("net contents")),
    governmentWarningRequired: expected.governmentWarningRequired ?? expected.government_warning_required ?? true,
    producerName: applicantName,
    countryOfOrigin: firstValue(expected.countryOfOrigin, expected.country_of_origin, application.countryOfOrigin, application.origin, rawFields.get("origin code")),
    applicationId: firstValue(expected.applicationId, expected.application_id, application.applicationId, payload?.ttb_id, rawFields.get("ttb id")),
    labelId: firstValue(expected.labelId, expected.label_id, application.labelId, payload?.serial_number, rawFields.get("serial #")),
    submitter: applicantName,
    notes: payload?.source?.system ? `Imported from ${payload.source.system}.` : undefined
  });
}

function valuesFromStructuredText(text: string): Partial<ApplicantFormValues> {
  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(text, text.trim().startsWith("<?xml") ? "application/xml" : "text/html");
    const tags: Record<string, string> = {};
    document.querySelectorAll("*").forEach((node) => {
      const key = node.nodeName.replace(/[_-]+/g, " ").toLowerCase();
      const value = node.textContent?.trim();
      if (value && value.length < 300 && !tags[key]) tags[key] = value;
    });
    const tagValues = compactValues({
      brandName: firstValue(tags.brandname, tags["brand name"]),
      fancifulName: firstValue(tags.fancifulname, tags["fanciful name"]),
      classType: firstValue(tags.classtype, tags["class type"], tags["class/type code"]),
      alcoholContent: firstValue(tags.alcoholcontent, tags["alcohol content"]),
      netContents: firstValue(tags.netcontents, tags["net contents"]),
      countryOfOrigin: firstValue(tags.countryoforigin, tags.origin, tags["origin code"]),
      applicationId: firstValue(tags.ttbid, tags["ttb id"], tags.applicationid),
      labelId: firstValue(tags.serialnumber, tags["serial number"])
    });
    if (Object.keys(tagValues).length) return { ...valuesFromLabelText(text), ...tagValues };
  }
  return valuesFromLabelText(text.replace(/<[^>]+>/g, "\n"));
}

function valuesFromLabelText(text: string): Partial<ApplicantFormValues> {
  const normalized = text
    .replace(/&nbsp;/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n");
  const classType = labelValue(normalized, ["Class/Type Code", "Class/Type", "Class Type"]);
  return compactValues({
    productType: normalizeProductType(inferProductType(classType)),
    brandName: labelValue(normalized, ["Brand Name", "Brand"]),
    fancifulName: labelValue(normalized, ["Fanciful Name"]),
    classType,
    alcoholContent: labelValue(normalized, ["Alcohol Content", "Alcohol", "ABV"]),
    netContents: labelValue(normalized, ["Net Contents", "Net Content"]),
    producerName: labelValue(normalized, ["Applicant Name", "Producer", "Importer"]),
    countryOfOrigin: labelValue(normalized, ["Origin Code", "Country of Origin", "Origin"]),
    applicationId: labelValue(normalized, ["TTB ID", "Application ID"]),
    labelId: labelValue(normalized, ["Serial #", "Serial Number", "Label ID"])
  });
}

function rawFieldMap(fields: unknown): Map<string, string> {
  if (!Array.isArray(fields)) return new Map();
  return new Map(fields.map((field: any) => [String(field?.label || "").trim().toLowerCase(), String(field?.value || "").trim()]));
}

function labelValue(text: string, labels: string[]): string {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`${escaped}[ \\t]*(?:[:#\\t]| {2,}|\\n+)\\s*([^\\n\\r]+)`, "i"));
    if (match?.[1]) return match[1].replace(/\s{2,}.*/, "").trim();
  }
  return "";
}

function firstValue(...values: unknown[]): string {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function compactValues(values: Partial<ApplicantFormValues>): Partial<ApplicantFormValues> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === "boolean" || String(value || "").trim())) as Partial<ApplicantFormValues>;
}

function normalizeProductType(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes("wine")) return "wine";
  if (lower.includes("malt") || lower.includes("beer") || lower.includes("ale") || lower.includes("stout")) return "malt_beverage";
  if (lower.includes("spirit") || lower.includes("vodka") || lower.includes("tequila") || lower.includes("rum") || lower.includes("whisk") || lower.includes("cocktail")) return "distilled_spirits";
  return value || "unknown";
}

function inferProductType(classType: string): string {
  return normalizeProductType(classType);
}

export function applicantFieldLabel(field: keyof ApplicantFormValues): string {
  const labels: Partial<Record<keyof ApplicantFormValues, string>> = {
    productType: "Product type",
    brandName: "Brand name",
    fancifulName: "Fanciful name",
    classType: "Class/type",
    alcoholContent: "Alcohol content",
    netContents: "Net contents",
    governmentWarningRequired: "Government health warning",
    producerName: "Producer / importer",
    countryOfOrigin: "Country of origin",
    applicationId: "TTB application ID",
    labelId: "Label ID",
    submitter: "Applicant / organization",
    notes: "Notes"
  };
  return labels[field] || String(field);
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read application data file."));
    reader.readAsText(file);
  });
}

function assessImage(file: File, width?: number, height?: number, role?: ImageRole): string[] {
  const warnings: string[] = [];
  const supported = ["image/jpeg", "image/png", "image/webp"];
  if (!supported.includes(file.type || "")) warnings.push("Demo upload accepts JPG, JPEG, PNG, or WebP.");
  if (file.size > 1.5 * 1024 * 1024) warnings.push("File is larger than the official 1.5 MB label-image limit.");
  if (file.size < 12 * 1024) warnings.push("File is very small; OCR evidence may be weak.");
  if (width && height) {
    if (width < 500 || height < 300) warnings.push("Image dimensions are small for label OCR.");
    const aspect = width / height;
    if (aspect > 4 || aspect < 0.2) warnings.push("Image aspect ratio looks unusual for a label panel.");
    if (role === "cola_sheet" && width > 1100 && height > 1100) warnings.push("COLA sheet images are useful for review; crop individual label panels before official filing.");
  }
  return warnings;
}

function isBlockingImageWarning(warning: string): boolean {
  return warning.startsWith("Demo upload accepts") || warning.startsWith("File is larger");
}

function readImageDimensions(url: string): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = url;
  });
}
