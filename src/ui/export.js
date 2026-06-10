import { APP_VERSION } from '../app-state.js';

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function statusForField(review, fieldName) {
  return review.fields.find((field) => field.field === fieldName)?.status || '';
}

export function buildJsonReport(review) {
  return {
    generatedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    mode: 'browser-local',
    overallStatus: review.overallStatus,
    files: review.files.map((file) => ({
      filename: file.name,
      processingTimeMs: file.ocrResult.processingTimeMs,
      ocrEngine: file.ocrResult.engine,
      source: file.ocrResult.source,
      preprocessingNotes: file.ocrResult.preprocessingNotes,
      rawText: file.ocrResult.rawText,
    })),
    fields: review.fields,
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
    review.fields.map((field) => `${field.field}: ${field.reason}`).join(' | '),
  ];

  const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  downloadBlob('ttb-label-review-summary.csv', `${headers.join(',')}\n${row.map(escapeCell).join(',')}\n`, 'text/csv');
}
