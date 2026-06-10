import { jsPDF } from 'jspdf';
import { APP_VERSION, FIELD_LABELS } from '../app-state.js';
import { STATUS } from '../validation/status.js';

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function displayStatus(status) {
  return {
    [STATUS.PASS]: 'Pass',
    [STATUS.FAIL]: 'Fail',
    [STATUS.WARNING]: 'Warning',
    [STATUS.NEEDS_REVIEW]: 'Needs Review',
    [STATUS.NOT_FOUND]: 'Not Found',
    [STATUS.PASS_WITH_WARNINGS]: 'Pass with Warnings',
  }[status] || status || '';
}

function effectiveStatus(field) {
  return field.agentStatus || field.status || '';
}

function statusForField(review, fieldName) {
  return effectiveStatus(review.fields.find((field) => field.field === fieldName) || {});
}

function exportableField(field) {
  return {
    field: field.field,
    expected: field.expected,
    extracted: field.extracted,
    autoStatus: field.status,
    finalStatus: effectiveStatus(field),
    autoReason: field.reason,
    agentNote: field.agentNote || '',
    confidence: field.confidence,
    severity: field.severity,
    history: field.history || [],
    evidenceCrops: (field.evidenceCrops || []).map((crop) => ({
      imageName: crop.imageName,
      text: crop.text,
      bbox: crop.bbox,
      confidence: crop.confidence,
    })),
  };
}

export function buildJsonReport(review) {
  return {
    generatedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    mode: review.mode || review.application?.mode || 'browser-local',
    application: review.application || null,
    expectedApplication: review.expectedApplication || null,
    overallStatus: review.overallStatus,
    timings: review.timings || null,
    enginesUsed: review.enginesUsed || [],
    workersUsed: review.workersUsed || [],
    files: review.files.map((file) => ({
      filename: file.name,
      processingTimeMs: file.ocrResult.processingTimeMs,
      ocrEngine: file.ocrResult.engine,
      source: file.ocrResult.source,
      preprocessingNotes: file.ocrResult.preprocessingNotes,
      rawText: file.ocrResult.rawText,
    })),
    fields: review.fields.map(exportableField),
  };
}

export function exportJsonReport(review) {
  downloadBlob('ttb-label-review-report.json', JSON.stringify(buildJsonReport(review), null, 2), 'application/json');
}

export function exportCsvSummary(review) {
  const headers = [
    'filename',
    'overallStatus',
    'brandStatus',
    'classTypeStatus',
    'alcoholStatus',
    'netContentsStatus',
    'governmentWarningStatus',
    'processingTimeMs',
    'notes',
  ];
  const processingTimeMs = review.files.reduce((sum, file) => sum + (file.ocrResult.processingTimeMs || 0), 0);
  const row = [
    review.files.map((file) => file.name).join(' + '),
    review.overallStatus,
    statusForField(review, 'Brand Name'),
    statusForField(review, 'Class/Type'),
    statusForField(review, 'Alcohol Content'),
    statusForField(review, 'Net Contents'),
    statusForField(review, 'Government Warning'),
    processingTimeMs,
    review.fields
      .map((field) => `${field.field}: auto=${field.status}; final=${effectiveStatus(field)}; ${field.agentNote || field.reason}`)
      .join(' | '),
  ];

  const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  downloadBlob('ttb-label-review-summary.csv', `${headers.join(',')}\n${row.map(escapeCell).join(',')}\n`, 'text/csv');
}

function filenameSlug(value = 'ttb-label-review-report') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function imageFormat(dataUrl) {
  return dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
}

async function sourceToDataUrl(src) {
  if (!src) return null;
  if (src.startsWith('data:')) return src;
  const response = await fetch(src);
  if (!response.ok) return null;
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function imageInfo(src) {
  const dataUrl = await sourceToDataUrl(src);
  if (!dataUrl) return null;
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        dataUrl,
        width: image.naturalWidth || image.width || 1,
        height: image.naturalHeight || image.height || 1,
      });
    image.onerror = () => resolve({ dataUrl, width: 1, height: 1 });
    image.src = dataUrl;
  });
}

function addPageIfNeeded(doc, y, needed = 20) {
  if (y + needed <= 282) return y;
  doc.addPage();
  return 18;
}

function addSectionTitle(doc, title, y) {
  y = addPageIfNeeded(doc, y, 12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(22, 33, 30);
  doc.text(title, 14, y);
  doc.setDrawColor(217, 213, 199);
  doc.line(14, y + 3, 196, y + 3);
  return y + 10;
}

function addLabeledText(doc, label, value, x, y, width) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(85, 96, 89);
  doc.text(label, x, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(24, 33, 30);
  const lines = doc.splitTextToSize(String(value || '-'), width);
  doc.text(lines, x, y + 5);
  return y + 6 + lines.length * 4;
}

function addExpectedFields(doc, review, y) {
  const expected = review.expectedApplication || {};
  const items = [
    [FIELD_LABELS.applicationId, expected.applicationId],
    [FIELD_LABELS.labelId, expected.labelId],
    [FIELD_LABELS.brandName, expected.brandName],
    [FIELD_LABELS.classType, expected.classType],
    [FIELD_LABELS.alcoholContent, expected.alcoholContent],
    [FIELD_LABELS.netContents, expected.netContents],
    [FIELD_LABELS.governmentWarning, expected.governmentWarningRequired ? 'Required' : 'Not required'],
    [FIELD_LABELS.producerName, expected.producerName],
    [FIELD_LABELS.countryOfOrigin, expected.countryOfOrigin],
  ];

  let leftY = y;
  let rightY = y;
  items.forEach(([label, value], index) => {
    if (index % 2 === 0) leftY = addLabeledText(doc, label, value, 14, leftY, 84);
    else rightY = addLabeledText(doc, label, value, 108, rightY, 84);
  });
  return Math.max(leftY, rightY) + 4;
}

async function addApplicationImage(doc, review, y) {
  const file = review.files[0];
  if (!file?.url) return y;
  const info = await imageInfo(file.url);
  if (!info) return y;
  y = addPageIfNeeded(doc, y, 92);
  const maxWidth = 182;
  const maxHeight = 92;
  const scale = Math.min(maxWidth / info.width, maxHeight / info.height);
  const width = info.width * scale;
  const height = info.height * scale;
  doc.addImage(info.dataUrl, imageFormat(info.dataUrl), 14, y, width, height);
  return y + height + 8;
}

async function addEvidenceCrops(doc, crops, x, y) {
  let cursorX = x;
  let cursorY = y;
  for (const crop of crops.slice(0, 3)) {
    const info = await imageInfo(crop.src);
    if (!info) continue;
    const width = 38;
    const height = Math.min(24, (info.height / info.width) * width);
    if (cursorX + width > 196) {
      cursorX = x;
      cursorY += 29;
    }
    doc.addImage(info.dataUrl, imageFormat(info.dataUrl), cursorX, cursorY, width, height);
    cursorX += width + 5;
  }
  return crops.length ? cursorY + 28 : y;
}

async function addFieldResults(doc, review, y) {
  for (const field of review.fields) {
    y = addPageIfNeeded(doc, y, 38);
    doc.setFillColor(248, 247, 241);
    doc.roundedRect(14, y - 4, 182, 12, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(24, 33, 30);
    doc.text(field.field, 18, y + 3);
    doc.setFontSize(9);
    doc.text(`Final: ${displayStatus(effectiveStatus(field))}`, 138, y + 3);
    y += 13;

    y = addLabeledText(doc, 'Expected', field.expected, 18, y, 172);
    y = addLabeledText(doc, 'Extracted evidence', field.extracted || 'No evidence found', 18, y, 172);
    y = addLabeledText(doc, 'Automatic finding', `${displayStatus(field.status)} - ${field.reason}`, 18, y, 172);
    if (field.agentNote) y = addLabeledText(doc, 'Reviewer notes', field.agentNote, 18, y, 172);
    if (field.evidenceCrops?.length) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(85, 96, 89);
      doc.text('Evidence crops', 18, y);
      y = await addEvidenceCrops(doc, field.evidenceCrops, 18, y + 3);
    }
    y += 6;
  }
  return y;
}

export async function exportPdfReport(review) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const generatedAt = new Date().toLocaleString();
  const title = review.application?.title || review.expectedApplication?.labelId || 'TTB Label Review';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(22, 33, 30);
  doc.text('TTB Label Review Report', 14, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(title, 14, 26);
  doc.text(`Generated ${generatedAt}`, 14, 32);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`Final decision: ${displayStatus(review.overallStatus)}`, 14, 41);

  let y = 53;
  y = addSectionTitle(doc, 'Submission', y);
  y = addExpectedFields(doc, review, y);
  y = addSectionTitle(doc, 'Application Image', y);
  y = await addApplicationImage(doc, review, y);
  y = addSectionTitle(doc, 'Review Evidence And Decisions', y);
  y = await addFieldResults(doc, review, y);

  y = addPageIfNeeded(doc, y, 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Source files', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(
    review.files.map((file) => `${file.name} (${file.ocrResult.engine}, ${file.ocrResult.processingTimeMs} ms)`).join('\n'),
    14,
    y + 5,
  );

  doc.save(`${filenameSlug(title)}-review-report.pdf`);
}
