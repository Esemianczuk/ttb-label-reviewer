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
  runOcr?: boolean;
  validateGovernmentWarning?: boolean;
  autoSubmitWhenReady?: boolean;
  browserWorkerOverride?: string;
};

export const DEFAULT_APPLICANT_VALUES: Partial<ApplicantFormValues> = {
  productType: "distilled_spirits",
  governmentWarningRequired: true,
  submitter: "Evaluator upload",
  runOcr: true,
  validateGovernmentWarning: true,
  autoSubmitWhenReady: false,
  browserWorkerOverride: "auto"
};

export function imageCountLabel(count: number): string {
  return `${count} label image${count === 1 ? "" : "s"}`;
}

export function toLabelImages(images: DraftUploadImage[]): LabelImage[] {
  return images.map((image, index) => ({
    id: `upload-${Date.now()}-${index}-${image.uid}`,
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
    productType: values.productType,
    brandName: values.brandName,
    fancifulName: values.fancifulName,
    classType: values.classType,
    alcoholContent: values.alcoholContent,
    netContents: values.netContents,
    governmentWarningRequired: values.governmentWarningRequired,
    producerName: values.producerName,
    countryOfOrigin: values.countryOfOrigin,
    applicationId: values.applicationId,
    labelId: values.labelId
  };
}

export function readinessIssues(application: ReviewApplication): string[] {
  const issues: string[] = [];
  if (!application.images.length) issues.push("At least one label image is required.");
  if (!application.expectedFields.brandName) issues.push("Brand name is required.");
  if (!application.expectedFields.classType) issues.push("Class/type is required.");
  if (!application.expectedFields.alcoholContent) issues.push("Alcohol content is required.");
  if (!application.expectedFields.netContents) issues.push("Net contents are required.");
  for (const image of application.images) {
    for (const warning of image.qualityWarnings || []) issues.push(`${image.name}: ${warning}`);
  }
  return issues;
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

function readImageDimensions(url: string): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = url;
  });
}
