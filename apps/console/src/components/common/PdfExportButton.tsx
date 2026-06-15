import { DownloadOutlined } from "@ant-design/icons";
import { App as AntApp, Button } from "antd";
import type { ButtonProps } from "antd";
import jsPDF from "jspdf";
import { useState } from "react";
import { fieldLabels } from "../../domain/application/demoData";
import { cropBoxForImage } from "../../domain/application/evidenceCrops";
import { applicationNumberFor } from "../../domain/application/applicationNumber";
import type {
  EvidenceCrop,
  ExpectedFields,
  FieldStatus,
  LabelImage,
  ReviewApplication,
  ReviewEvidence,
  ReviewField,
  ReviewStatus
} from "../../domain/application/types";

type PdfExportButtonProps = {
  application: ReviewApplication;
  pageName: string;
  children?: React.ReactNode;
  type?: ButtonProps["type"];
  size?: ButtonProps["size"];
  block?: boolean;
};

type RGB = readonly [number, number, number];

type ReportContext = {
  doc: jsPDF;
  application: ReviewApplication;
  pageName: string;
  generatedAt: string;
  y: number;
};

type ImageAsset = {
  dataUrl: string;
  width: number;
  height: number;
};

type TextStyle = {
  size?: number;
  color?: RGB;
  fontStyle?: "normal" | "bold" | "italic";
  lineHeight?: number;
  maxLines?: number;
  align?: "left" | "center" | "right";
};

const PAGE = {
  width: 612,
  height: 792,
  margin: 40,
  contentWidth: 532,
  footerY: 758,
  bottom: 730
} as const;

const COLORS = {
  navy: [18, 35, 62] as RGB,
  navySoft: [33, 64, 104] as RGB,
  blue: [25, 92, 164] as RGB,
  blueSoft: [232, 241, 252] as RGB,
  surface: [248, 250, 252] as RGB,
  surfaceStrong: [241, 245, 249] as RGB,
  border: [205, 216, 230] as RGB,
  borderDark: [158, 171, 190] as RGB,
  text: [29, 40, 55] as RGB,
  muted: [87, 99, 116] as RGB,
  white: [255, 255, 255] as RGB,
  success: [24, 119, 72] as RGB,
  successSoft: [229, 247, 236] as RGB,
  error: [185, 36, 29] as RGB,
  errorSoft: [253, 235, 233] as RGB,
  warning: [154, 98, 0] as RGB,
  warningSoft: [255, 246, 219] as RGB,
  neutral: [99, 112, 132] as RGB,
  neutralSoft: [239, 242, 247] as RGB
} as const;

const PASSING_STATUSES: FieldStatus[] = ["PASS", "PASS_WITH_WARNINGS", "NOT_APPLICABLE"];
const FAILING_STATUSES: FieldStatus[] = ["FAIL", "NOT_FOUND"];
export function PdfExportButton({ application, pageName, children, type, size, block }: PdfExportButtonProps) {
  const [loading, setLoading] = useState(false);
  const { message: messageApi } = AntApp.useApp();

  return (
    <Button
      type={type}
      size={size}
      block={block}
      icon={<DownloadOutlined />}
      loading={loading}
      onClick={async () => {
        setLoading(true);
        try {
          await downloadApplicationPdf(application, pageName);
          messageApi.success("PDF report downloaded.");
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Please try again.";
          messageApi.error(`Could not create PDF report. ${detail}`);
        } finally {
          setLoading(false);
        }
      }}
    >
      {children || "PDF"}
    </Button>
  );
}

export async function downloadApplicationPdf(application: ReviewApplication, pageName: string) {
  const doc = await createApplicationPdf(application, pageName);
  doc.save(buildPdfFileName(application, pageName));
}

export function buildPdfFileName(application: ReviewApplication, pageName: string) {
  const safePageName = pageName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const safeApplicationNumber = applicationNumberFor(application).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${safeApplicationNumber || application.id}-${safePageName || "report"}.pdf`;
}

export async function createApplicationPdf(application: ReviewApplication, pageName: string) {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const ctx: ReportContext = {
    doc,
    application,
    pageName,
    generatedAt: new Date().toISOString(),
    y: PAGE.margin
  };

  drawCover(ctx);
  drawApplicationOverview(ctx);
  drawExpectedFields(ctx);
  await drawImageEvidence(ctx);
  await drawFieldEvidence(ctx);
  drawReviewerNotes(ctx);
  drawProcessingTrace(ctx);
  drawRawOcrAppendix(ctx);
  drawFooters(ctx);

  return doc;
}

function drawCover(ctx: ReportContext) {
  const { doc, application, pageName } = ctx;
  const finalStatus = getOverallStatus(application);
  const stats = getFieldStats(application.review?.fields || []);

  setFill(doc, COLORS.navy);
  doc.rect(0, 0, PAGE.width, 136, "F");
  setFill(doc, COLORS.blue);
  doc.rect(0, 132, PAGE.width, 4, "F");

  setFont(doc, 12, "bold", COLORS.blueSoft);
  doc.text("TTB LABEL REVIEW WORKBENCH", PAGE.margin, 44);
  setFont(doc, 26, "bold", COLORS.white);
  doc.text("Reviewer Report", PAGE.margin, 76);
  setFont(doc, 11, "normal", COLORS.blueSoft);
  doc.text(pageName, PAGE.margin, 100);
  drawBadge(doc, PAGE.width - PAGE.margin - 118, 42, 118, 26, statusLabel(finalStatus), finalStatus);

  ctx.y = 170;
  setFont(doc, 17, "bold", COLORS.text);
  doc.text(application.title, PAGE.margin, ctx.y);
  ctx.y += 18;
  setFont(doc, 10.5, "bold", COLORS.blue);
  doc.text(`Application # ${applicationNumberFor(application)}`, PAGE.margin, ctx.y);
  ctx.y += 16;
  drawWrappedText(ctx, application.metadata.description || "One-image label application packet prepared for reviewer validation.", PAGE.margin, ctx.y, PAGE.contentWidth, {
    size: 10.5,
    color: COLORS.muted,
    lineHeight: 14,
    maxLines: 3
  });
  ctx.y += 30;

  const statY = ctx.y;
  drawMetric(doc, PAGE.margin, statY, 118, "Fields passed", String(stats.passed), COLORS.success);
  drawMetric(doc, PAGE.margin + 132, statY, 118, "Field failures", String(stats.failed), stats.failed ? COLORS.error : COLORS.neutral);
  drawMetric(doc, PAGE.margin + 264, statY, 118, "Needs review", String(stats.needsReview), stats.needsReview ? COLORS.warning : COLORS.neutral);
  drawMetric(doc, PAGE.margin + 396, statY, 136, "Reviewer changes", String(stats.overrides), stats.overrides ? COLORS.blue : COLORS.neutral);
  ctx.y = statY + 84;

  drawPanel(ctx, PAGE.margin, ctx.y, PAGE.contentWidth, 84, { fill: COLORS.surface, stroke: COLORS.border });
  setFont(doc, 10, "bold", COLORS.muted);
  doc.text("Review basis", PAGE.margin + 14, ctx.y + 23);
  setFont(doc, 10, "normal", COLORS.text);
  drawWrappedText(
    ctx,
    application.review?.summary ||
      "No automated review has been stored for this packet yet. The report contains the submitted application values and label images that are available.",
    PAGE.margin + 14,
    ctx.y + 43,
    PAGE.contentWidth - 28,
    { size: 10, lineHeight: 13, maxLines: 3 }
  );
  ctx.y += 112;
}

function drawApplicationOverview(ctx: ReportContext) {
  const { application } = ctx;
  drawSectionTitle(ctx, "Application Overview");
  const review = application.review;
  const rows: Array<[string, string]> = [
    ["Application #", applicationNumberFor(application)],
    ["Application", application.title],
    ["Filed TTB application ID", application.expectedFields.applicationId || "Not supplied"],
    ["Console record ID", application.id],
    ["Current status", readableStatus(application.status)],
    ["Report result", statusLabel(getOverallStatus(application))],
    ["Submitted by", application.submitter],
    ["Assigned reviewer", application.assignedTo || "Unassigned"],
    ["Source", readableStatus(application.source)],
    ["Created", formatDate(application.createdAt)],
    ["Updated", formatDate(application.updatedAt)],
    ["Review mode", review ? readableStatus(review.mode) : "Not reviewed"],
    ["Review completed", review?.completedAt ? formatDate(review.completedAt) : "Not completed"]
  ];
  drawKeyValueGrid(ctx, rows);
  ctx.y += 14;
}

function drawExpectedFields(ctx: ReportContext) {
  drawSectionTitle(ctx, "Submitted Application Data");
  const rows = expectedFieldEntries(ctx.application.expectedFields);
  drawSimpleTable(ctx, ["Field", "Submitted value"], rows, [170, 342]);
  ctx.y += 14;
}

async function drawImageEvidence(ctx: ReportContext) {
  const { doc, application } = ctx;
  drawSectionTitle(ctx, "Label Image Evidence");
  const images = application.images;
  if (!images.length) {
    drawEmptyPanel(ctx, "No label images were attached to this application.");
    ctx.y += 14;
    return;
  }

  const firstImage = images[0];
  const firstAsset = await imageToJpegDataUrl(firstImage.url);
  const panelHeight = 188;
  ensureSpace(ctx, panelHeight + 18);
  drawPanel(ctx, PAGE.margin, ctx.y, PAGE.contentWidth, panelHeight, { fill: COLORS.surface, stroke: COLORS.border });

  const imageX = PAGE.margin + 14;
  const imageY = ctx.y + 18;
  if (firstAsset) {
    drawImageContained(doc, firstAsset, imageX, imageY, 218, 142);
  } else {
    drawImagePlaceholder(doc, imageX, imageY, 218, 142, "Image unavailable");
  }

  const detailX = imageX + 238;
  setFont(doc, 11, "bold", COLORS.text);
  doc.text(firstImage.name || "Label image", detailX, imageY + 4);
  const details: Array<[string, string]> = [
    ["Role", readableStatus(firstImage.role)],
    ["MIME type", firstImage.mimeType],
    ["Image source", readableStatus(firstImage.source)],
    ["Stored dimensions", firstImage.width && firstImage.height ? `${firstImage.width} x ${firstImage.height}` : "Detected at export time"],
    ["Evidence image count", String(images.length)]
  ];
  let y = imageY + 28;
  details.forEach(([label, value]) => {
    setFont(doc, 8.5, "bold", COLORS.muted);
    doc.text(label, detailX, y);
    setFont(doc, 9.5, "normal", COLORS.text);
    drawWrappedText(ctx, value, detailX + 96, y, PAGE.margin + PAGE.contentWidth - detailX - 110, {
      size: 9.5,
      lineHeight: 11,
      maxLines: 2
    });
    y += 23;
  });

  ctx.y += panelHeight + 18;

  if (images.length > 1) {
    ensureSpace(ctx, 70 + images.length * 18);
    drawSimpleTable(
      ctx,
      ["Image", "Role"],
      images.map((image) => [image.name || image.id, readableStatus(image.role)]),
      [350, 162]
    );
    ctx.y += 14;
  }
}

async function drawFieldEvidence(ctx: ReportContext) {
  const fields = ctx.application.review?.fields || [];
  if (fields.length) ensureSpace(ctx, 270);
  drawSectionTitle(ctx, "Expected vs Extracted Field Comparison");
  if (!fields.length) {
    drawEmptyPanel(ctx, "No field-level review has been stored for this packet yet.");
    ctx.y += 14;
    return;
  }

  for (const field of fields) {
    await drawFieldCard(ctx, field);
  }
  ctx.y += 10;
}

async function drawFieldCard(ctx: ReportContext, field: ReviewField) {
  const { doc, application } = ctx;
  const evidence = field.evidence[0];
  const image = findEvidenceImage(application.images, evidence);
  const crop = evidence?.crop;
  const trustedCrop = shouldShowCrop(crop) ? crop : undefined;
  const cropAsset = image && trustedCrop ? await imageToJpegDataUrl(image.url, trustedCrop) : null;
  const finalStatus = getFieldStatus(field);
  const overridden = Boolean(field.reviewerStatus) && field.reviewerStatus !== field.status;
  const columnTopOffset = overridden ? 62 : 52;
  const reason = field.reviewerReason || field.reason;
  const reasonLines = wrappedLines(doc, reason || "No reasoning recorded.", PAGE.contentWidth - 28, 9, 4);
  const cardHeight = Math.max(216, columnTopOffset + 120 + 14 + reasonLines.length * 12 + 18);
  const valueTextSize = Math.min(9.2, Math.max(field.expected.length, field.extracted.length) > 34 ? 7.8 : Math.max(field.expected.length, field.extracted.length) > 24 ? 8.5 : 9.2);

  ensureSpace(ctx, cardHeight + 12);
  const x = PAGE.margin;
  const y = ctx.y;
  drawPanel(ctx, x, y, PAGE.contentWidth, cardHeight, { fill: COLORS.white, stroke: COLORS.border });

  setFill(doc, statusSoftColor(finalStatus));
  doc.rect(x, y, 6, cardHeight, "F");
  setFont(doc, 12, "bold", COLORS.text);
  doc.text(field.label || fieldLabels[field.fieldKey] || field.fieldKey, x + 16, y + 24);
  drawBadge(doc, x + PAGE.contentWidth - 98, y + 12, 82, 24, passFailLabel(finalStatus), finalStatus);
  setFont(doc, 8.5, "normal", COLORS.muted);
  doc.text(`Confidence ${formatPercent(field.confidence)}`, x + PAGE.contentWidth - 98, y + 48);

  if (overridden) {
    setFont(doc, 8.7, "bold", COLORS.blue);
    doc.text(`Reviewer override: automated ${passFailLabel(field.status)} changed to ${passFailLabel(finalStatus)}`, x + 16, y + 43);
  }

  const columnTop = y + columnTopOffset;
  drawColumnLabel(doc, x + 16, columnTop, "Expected application value");
  drawColumnLabel(doc, x + 190, columnTop, "Extracted label evidence");
  drawColumnLabel(doc, x + 364, columnTop, cropAsset ? "Evidence crop" : "Evidence source");

  drawTextBox(doc, x + 16, columnTop + 16, 158, 76, field.expected || "Not supplied", { size: valueTextSize, maxLines: 5 });
  drawTextBox(doc, x + 190, columnTop + 16, 158, 76, field.extracted || "Not supplied", { size: valueTextSize, maxLines: 5, muted: overridden });

  if (cropAsset) {
    drawImageContained(doc, cropAsset, x + 364, columnTop + 16, 148, 76);
    setFont(doc, 7.8, "normal", COLORS.blue);
    doc.text("OCR/entity crop used for extraction", x + 364, columnTop + 104);
  } else {
    drawTextBox(doc, x + 364, columnTop + 16, 148, 76, evidence?.excerpt || field.extracted || "No evidence excerpt available.", {
      size: Math.min(8.8, valueTextSize),
      maxLines: 5,
      muted: overridden
    });
  }

  const reasonY = columnTop + 120;
  setFont(doc, 8.4, "bold", COLORS.muted);
  doc.text("Reasoning", x + 16, reasonY);
  setFont(doc, 9, "normal", COLORS.text);
  doc.text(reasonLines, x + 16, reasonY + 14);
  ctx.y += cardHeight + 12;
}

function drawReviewerNotes(ctx: ReportContext) {
  const { application } = ctx;
  const review = application.review;
  drawSectionTitle(ctx, "Reviewer Disposition");
  const rows: Array<[string, string]> = [
    ["Overall reviewer status", review?.reviewerOverallStatus ? statusLabel(review.reviewerOverallStatus) : "No reviewer override recorded"],
    ["Reviewer notes", review?.reviewerNotes || application.metadata.reviewerDecisionNote || "No reviewer notes recorded."],
    ["Decision metadata", application.metadata.reviewerDecision ? readableStatus(application.metadata.reviewerDecision) : "No final decision recorded"]
  ];
  drawFullWidthKeyValues(ctx, rows);
  ctx.y += 14;
}

function drawProcessingTrace(ctx: ReportContext) {
  const trace = ctx.application.review?.engineTrace || [];
  drawSectionTitle(ctx, "Processing Trace");
  if (!trace.length) {
    drawEmptyPanel(ctx, "No processing trace has been recorded for this packet.");
    ctx.y += 14;
    return;
  }
  const rows = trace.map((item, index) => [String(index + 1), item]);
  drawSimpleTable(ctx, ["Step", "Recorded action"], rows, [54, 458]);
  ctx.y += 14;
}

function drawRawOcrAppendix(ctx: ReportContext) {
  const rawText = rawOcrTextForReport(ctx.application);
  if (!rawText) return;
  ensureSpace(ctx, 170);
  drawSectionTitle(ctx, "Raw OCR Text Appendix");
  const text = rawText.length > 2600 ? `${rawText.slice(0, 2600)}\n\n[OCR text truncated for PDF readability.]` : rawText;
  const lines = text.split(/\r?\n/).flatMap((line) => (line.trim() ? wrappedLines(ctx.doc, line, PAGE.contentWidth - 28, 8.2) : [""]));
  let index = 0;
  while (index < lines.length) {
    ensureSpace(ctx, 96);
    const availableRows = Math.max(4, Math.floor((PAGE.bottom - ctx.y - 28) / 10));
    const rows = lines.slice(index, index + availableRows);
    const height = rows.length * 10 + 26;
    drawPanel(ctx, PAGE.margin, ctx.y, PAGE.contentWidth, height, { fill: COLORS.surface, stroke: COLORS.border });
    setFont(ctx.doc, 8.2, "normal", COLORS.text);
    ctx.doc.text(rows, PAGE.margin + 14, ctx.y + 18);
    ctx.y += height + 10;
    index += rows.length;
  }
  ctx.y += 4;
}

function drawSectionTitle(ctx: ReportContext, title: string) {
  ensureSpace(ctx, 46);
  setFont(ctx.doc, 14, "bold", COLORS.navy);
  ctx.doc.text(title, PAGE.margin, ctx.y);
  setStroke(ctx.doc, COLORS.border);
  ctx.doc.line(PAGE.margin, ctx.y + 10, PAGE.margin + PAGE.contentWidth, ctx.y + 10);
  ctx.y += 25;
}

function drawMetric(doc: jsPDF, x: number, y: number, width: number, label: string, value: string, color: RGB) {
  drawPanelRaw(doc, x, y, width, 62, { fill: COLORS.surface, stroke: COLORS.border });
  setFont(doc, 22, "bold", color);
  doc.text(value, x + 12, y + 29);
  setFont(doc, 8.7, "bold", COLORS.muted);
  doc.text(label, x + 12, y + 49);
}

function drawKeyValueGrid(ctx: ReportContext, rows: Array<[string, string]>) {
  const rowHeight = 39;
  const panelHeight = Math.ceil(rows.length / 2) * rowHeight + 18;
  ensureSpace(ctx, panelHeight + 8);
  const x = PAGE.margin;
  const y = ctx.y;
  drawPanel(ctx, x, y, PAGE.contentWidth, panelHeight, { fill: COLORS.white, stroke: COLORS.border });
  rows.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const cellX = x + 14 + column * 258;
    const cellY = y + 21 + row * rowHeight;
    setFont(ctx.doc, 8.2, "bold", COLORS.muted);
    ctx.doc.text(label, cellX, cellY);
    setFont(ctx.doc, 9.3, "normal", COLORS.text);
    const valueLines = wrappedLines(ctx.doc, value || "Not supplied", 172, 9.3, 2);
    ctx.doc.text(valueLines, cellX + 82, cellY);
  });
  ctx.y += panelHeight + 8;
}

function drawFullWidthKeyValues(ctx: ReportContext, rows: Array<[string, string]>) {
  const labelWidth = 152;
  const valueWidth = PAGE.contentWidth - labelWidth - 40;
  const rowHeights = rows.map(([, value]) => Math.max(32, wrappedLines(ctx.doc, value || "Not supplied", valueWidth, 9.4, 4).length * 12 + 14));
  const panelHeight = rowHeights.reduce((sum, height) => sum + height, 0) + 18;
  ensureSpace(ctx, panelHeight + 10);
  const x = PAGE.margin;
  const y = ctx.y;
  drawPanel(ctx, x, y, PAGE.contentWidth, panelHeight, { fill: COLORS.white, stroke: COLORS.border });

  let cursorY = y + 22;
  rows.forEach(([label, value], index) => {
    if (index > 0) {
      setStroke(ctx.doc, COLORS.border);
      ctx.doc.line(x + 14, cursorY - 12, x + PAGE.contentWidth - 14, cursorY - 12);
    }
    setFont(ctx.doc, 8.7, "bold", COLORS.muted);
    ctx.doc.text(label, x + 14, cursorY);
    setFont(ctx.doc, 9.4, "normal", COLORS.text);
    ctx.doc.text(wrappedLines(ctx.doc, value || "Not supplied", valueWidth, 9.4, 4), x + 14 + labelWidth, cursorY);
    cursorY += rowHeights[index];
  });

  ctx.y += panelHeight + 8;
}

function drawSimpleTable(ctx: ReportContext, headers: string[], rows: string[][], columnWidths: number[]) {
  const rowHeight = 30;
  const headerHeight = 28;
  const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  let rowIndex = 0;

  while (rowIndex < rows.length) {
    ensureSpace(ctx, headerHeight + rowHeight + 10);
    const startY = ctx.y;
    drawTableHeader(ctx.doc, PAGE.margin, startY, totalWidth, headerHeight, headers, columnWidths);
    ctx.y += headerHeight;
    while (rowIndex < rows.length && ctx.y + rowHeight < PAGE.bottom) {
      drawTableRow(ctx.doc, PAGE.margin, ctx.y, rowHeight, rows[rowIndex], columnWidths);
      ctx.y += rowHeight;
      rowIndex += 1;
    }
  }
}

function rawOcrTextForReport(application: ReviewApplication): string {
  const review =
    application.review as
      | (ReviewApplication["review"] & {
          rawText?: string;
          combinedText?: string;
          combinedOcr?: { rawText?: string };
        })
      | undefined;
  return String(review?.rawOcrText || review?.rawText || review?.combinedText || review?.combinedOcr?.rawText || "").trim();
}

function drawTableHeader(doc: jsPDF, x: number, y: number, width: number, height: number, headers: string[], columnWidths: number[]) {
  setFill(doc, COLORS.surfaceStrong);
  setStroke(doc, COLORS.border);
  doc.rect(x, y, width, height, "FD");
  let cursor = x;
  headers.forEach((header, index) => {
    setFont(doc, 8.6, "bold", COLORS.text);
    doc.text(header, cursor + 10, y + 18);
    if (index > 0) {
      setStroke(doc, COLORS.border);
      doc.line(cursor, y, cursor, y + height);
    }
    cursor += columnWidths[index];
  });
}

function drawTableRow(doc: jsPDF, x: number, y: number, height: number, cells: string[], columnWidths: number[]) {
  setStroke(doc, COLORS.border);
  doc.rect(x, y, columnWidths.reduce((sum, width) => sum + width, 0), height, "S");
  let cursor = x;
  cells.forEach((cell, index) => {
    const width = columnWidths[index];
    setFont(doc, index === 0 ? 8.8 : 9.2, index === 0 ? "bold" : "normal", index === 0 ? COLORS.muted : COLORS.text);
    const lines = wrappedLines(doc, cell || "Not supplied", width - 18, index === 0 ? 8.8 : 9.2, 2);
    doc.text(lines, cursor + 10, y + 13);
    if (index > 0) {
      setStroke(doc, COLORS.border);
      doc.line(cursor, y, cursor, y + height);
    }
    cursor += width;
  });
}

function drawColumnLabel(doc: jsPDF, x: number, y: number, label: string) {
  setFont(doc, 8.3, "bold", COLORS.muted);
  doc.text(label, x, y);
}

function drawTextBox(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  options: { size: number; maxLines?: number; muted?: boolean }
) {
  setFill(doc, options.muted ? COLORS.neutralSoft : COLORS.surface);
  setStroke(doc, COLORS.border);
  doc.rect(x, y, width, height, "FD");
  setFont(doc, options.size, "normal", options.muted ? COLORS.muted : COLORS.text);
  const lines = wrappedLines(doc, text, width - 14, options.size, options.maxLines);
  doc.text(lines, x + 7, y + 14);
}

function drawBadge(doc: jsPDF, x: number, y: number, width: number, height: number, text: string, status: FieldStatus | ReviewStatus) {
  setFill(doc, statusSoftColor(status));
  setStroke(doc, statusColor(status));
  doc.roundedRect(x, y, width, height, 4, 4, "FD");
  setFont(doc, 8.8, "bold", statusColor(status));
  doc.text(text, x + width / 2, y + height / 2 + 3, { align: "center" });
}

function drawPanel(ctx: ReportContext, x: number, y: number, width: number, height: number, style: { fill: RGB; stroke: RGB }) {
  drawPanelRaw(ctx.doc, x, y, width, height, style);
}

function drawPanelRaw(doc: jsPDF, x: number, y: number, width: number, height: number, style: { fill: RGB; stroke: RGB }) {
  setFill(doc, style.fill);
  setStroke(doc, style.stroke);
  doc.roundedRect(x, y, width, height, 5, 5, "FD");
}

function drawEmptyPanel(ctx: ReportContext, text: string) {
  ensureSpace(ctx, 62);
  drawPanel(ctx, PAGE.margin, ctx.y, PAGE.contentWidth, 54, { fill: COLORS.surface, stroke: COLORS.border });
  setFont(ctx.doc, 10, "normal", COLORS.muted);
  ctx.doc.text(text, PAGE.margin + 14, ctx.y + 31);
  ctx.y += 62;
}

function drawWrappedText(ctx: ReportContext, text: string, x: number, y: number, width: number, style: TextStyle = {}) {
  setFont(ctx.doc, style.size || 10, style.fontStyle || "normal", style.color || COLORS.text);
  const lines = wrappedLines(ctx.doc, text, width, style.size || 10, style.maxLines);
  ctx.doc.text(lines, x, y, { align: style.align || "left" });
  return lines.length * (style.lineHeight || (style.size || 10) + 3);
}

function wrappedLines(doc: jsPDF, text: string, width: number, size: number, maxLines?: number): string[] {
  doc.setFontSize(size);
  const normalized = String(text || "Not supplied")
    .replace(/\t/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();
  const split = doc.splitTextToSize(normalized || "Not supplied", width) as string[];
  if (!maxLines || split.length <= maxLines) return split;
  const clipped = split.slice(0, maxLines);
  clipped[maxLines - 1] = `${clipped[maxLines - 1].replace(/\.*$/, "")}...`;
  return clipped;
}

function ensureSpace(ctx: ReportContext, height: number) {
  if (ctx.y + height <= PAGE.bottom) return;
  ctx.doc.addPage();
  drawPageHeader(ctx);
}

function drawPageHeader(ctx: ReportContext) {
  const { doc, application } = ctx;
  setFill(doc, COLORS.navy);
  doc.rect(0, 0, PAGE.width, 34, "F");
  setFont(doc, 8.5, "bold", COLORS.white);
  doc.text("TTB Label Review Workbench", PAGE.margin, 22);
  setFont(doc, 8.5, "normal", COLORS.blueSoft);
  doc.text(applicationNumberFor(application), PAGE.width - PAGE.margin, 22, { align: "right" });
  ctx.y = PAGE.margin + 18;
}

function drawFooters(ctx: ReportContext) {
  const pageCount = ctx.doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    ctx.doc.setPage(page);
    setStroke(ctx.doc, COLORS.border);
    ctx.doc.line(PAGE.margin, PAGE.footerY - 16, PAGE.width - PAGE.margin, PAGE.footerY - 16);
    setFont(ctx.doc, 7.8, "normal", COLORS.muted);
    ctx.doc.text(`Generated ${formatDate(ctx.generatedAt)} from the local assessment demo.`, PAGE.margin, PAGE.footerY);
    ctx.doc.text(`Page ${page} of ${pageCount}`, PAGE.width - PAGE.margin, PAGE.footerY, { align: "right" });
  }
}

async function imageToJpegDataUrl(url: string, crop?: EvidenceCrop): Promise<ImageAsset | null> {
  try {
    if (typeof document === "undefined") return null;
    const image = await loadImage(url);
    const cropBox = crop ? cropBoxForImage(crop, image.naturalWidth || image.width, image.naturalHeight || image.height) : null;
    const sourceX = cropBox?.x || 0;
    const sourceY = cropBox?.y || 0;
    const sourceWidth = cropBox?.width || image.naturalWidth || image.width;
    const sourceHeight = cropBox?.height || image.naturalHeight || image.height;
    const scale = Math.min(1, 900 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.9),
      width: canvas.width,
      height: canvas.height
    };
  } catch {
    return null;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (!url.startsWith("blob:") && !url.startsWith("data:")) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image ${url}`));
    image.src = url;
  });
}

function drawImageContained(doc: jsPDF, asset: ImageAsset, x: number, y: number, maxWidth: number, maxHeight: number) {
  const ratio = Math.min(maxWidth / asset.width, maxHeight / asset.height);
  const width = asset.width * ratio;
  const height = asset.height * ratio;
  const drawX = x + (maxWidth - width) / 2;
  const drawY = y + (maxHeight - height) / 2;
  setFill(doc, COLORS.white);
  setStroke(doc, COLORS.border);
  doc.rect(x, y, maxWidth, maxHeight, "FD");
  doc.addImage(asset.dataUrl, "JPEG", drawX, drawY, width, height);
}

function drawImagePlaceholder(doc: jsPDF, x: number, y: number, width: number, height: number, text: string) {
  setFill(doc, COLORS.surfaceStrong);
  setStroke(doc, COLORS.border);
  doc.rect(x, y, width, height, "FD");
  setFont(doc, 9, "normal", COLORS.muted);
  doc.text(text, x + width / 2, y + height / 2, { align: "center" });
}

function findEvidenceImage(images: LabelImage[], evidence?: ReviewEvidence) {
  return images.find((image) => image.id === evidence?.sourceImageId) || images[0];
}

function shouldShowCrop(crop?: EvidenceCrop): crop is EvidenceCrop {
  return crop?.source === "ocr";
}

function expectedFieldEntries(fields: ExpectedFields): string[][] {
  const entries: Array<[keyof ExpectedFields, string]> = [
    ["productType", readableStatus(fields.productType)],
    ["brandName", fields.brandName],
    ["fancifulName", fields.fancifulName || ""],
    ["classType", fields.classType],
    ["alcoholContent", fields.alcoholContent],
    ["netContents", fields.netContents],
    ["producerName", fields.producerName || ""],
    ["countryOfOrigin", fields.countryOfOrigin || ""],
    ["applicationId", fields.applicationId || ""],
    ["labelId", fields.labelId || ""]
  ];
  const rows = entries
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => [fieldLabels[key] || key, value]);
  rows.splice(6, 0, ["Government Warning", fields.governmentWarningRequired ? "Required" : "Not required"]);
  return rows;
}

function getFieldStats(fields: ReviewField[]) {
  return fields.reduce(
    (stats, field) => {
      const finalStatus = getFieldStatus(field);
      if (PASSING_STATUSES.includes(finalStatus)) stats.passed += 1;
      else if (FAILING_STATUSES.includes(finalStatus)) stats.failed += 1;
      else stats.needsReview += 1;
      if (field.reviewerStatus && field.reviewerStatus !== field.status) stats.overrides += 1;
      return stats;
    },
    { passed: 0, failed: 0, needsReview: 0, overrides: 0 }
  );
}

function getOverallStatus(application: ReviewApplication): ReviewStatus {
  const review = application.review;
  if (!review) return "NEEDS_REVIEW";
  return review.reviewerOverallStatus || review.status;
}

function getFieldStatus(field: ReviewField): FieldStatus {
  return field.reviewerStatus || field.status;
}

function statusLabel(status: FieldStatus | ReviewStatus) {
  if (status === "PASS_WITH_WARNINGS") return "Pass with warnings";
  if (status === "NOT_APPLICABLE") return "Not applicable";
  if (status === "NEEDS_REVIEW") return "Needs review";
  if (status === "NOT_FOUND") return "Not found";
  return readableStatus(status);
}

function passFailLabel(status: FieldStatus | ReviewStatus) {
  if (PASSING_STATUSES.includes(status as FieldStatus)) return "Pass";
  if (FAILING_STATUSES.includes(status as FieldStatus)) return "Fail";
  return "Needs review";
}

function statusColor(status: FieldStatus | ReviewStatus): RGB {
  if (PASSING_STATUSES.includes(status as FieldStatus)) return COLORS.success;
  if (FAILING_STATUSES.includes(status as FieldStatus)) return COLORS.error;
  if (status === "WARNING" || status === "NEEDS_REVIEW") return COLORS.warning;
  return COLORS.neutral;
}

function statusSoftColor(status: FieldStatus | ReviewStatus): RGB {
  if (PASSING_STATUSES.includes(status as FieldStatus)) return COLORS.successSoft;
  if (FAILING_STATUSES.includes(status as FieldStatus)) return COLORS.errorSoft;
  if (status === "WARNING" || status === "NEEDS_REVIEW") return COLORS.warningSoft;
  return COLORS.neutralSoft;
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "n/a";
  return `${Math.round(value * 100)}%`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function readableStatus(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function setFill(doc: jsPDF, color: RGB) {
  doc.setFillColor(color[0], color[1], color[2]);
}

function setStroke(doc: jsPDF, color: RGB) {
  doc.setDrawColor(color[0], color[1], color[2]);
}

function setFont(doc: jsPDF, size: number, fontStyle: "normal" | "bold" | "italic", color: RGB) {
  doc.setFont("helvetica", fontStyle);
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
}
