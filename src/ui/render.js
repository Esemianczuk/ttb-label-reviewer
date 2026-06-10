import { FIELD_LABELS } from '../app-state.js';
import { STATUS } from '../validation/status.js';

export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function displayStatus(status) {
  return {
    [STATUS.PASS]: 'Pass',
    [STATUS.FAIL]: 'Mismatch',
    [STATUS.WARNING]: 'Warning',
    [STATUS.NEEDS_REVIEW]: 'Needs Review',
    [STATUS.NOT_FOUND]: 'Not Found',
    [STATUS.PASS_WITH_WARNINGS]: 'Pass with Warnings',
  }[status] || status;
}

function statusClass(status) {
  return String(status || '').toLowerCase().replaceAll('_', '-');
}

function confidenceText(confidence) {
  if (!Number.isFinite(confidence)) return 'Review hint unavailable';
  return `${Math.round(confidence * 100)}% match confidence`;
}

function imageList(images) {
  if (!images.length) {
    return '<p class="empty-note">No label images selected.</p>';
  }
  return `
    <div class="image-list">
      ${images
        .map(
          (image) => `
            <figure class="image-thumb">
              <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.name)} preview" />
              <figcaption>
                <strong>${escapeHtml(image.name)}</strong>
                <span>${image.source === 'sample' ? 'Bundled sample' : `${Math.round((image.size || 0) / 1024)} KB`}</span>
              </figcaption>
            </figure>
          `,
        )
        .join('')}
    </div>
  `;
}

function fieldRow(field) {
  return `
    <tr>
      <th scope="row">${escapeHtml(field.field)}</th>
      <td data-label="Expected">${escapeHtml(field.expected)}</td>
      <td data-label="Evidence">${escapeHtml(field.extracted || 'No evidence found')}</td>
      <td data-label="Status"><span class="status ${statusClass(field.status)}">${displayStatus(field.status)}</span></td>
      <td data-label="Reason">
        <p>${escapeHtml(field.reason)}</p>
        <small>${escapeHtml(confidenceText(field.confidence))}</small>
      </td>
    </tr>
  `;
}

function reviewPanel(review) {
  if (!review) {
    return `
      <section class="panel result-panel" aria-live="polite">
        <div class="panel-heading">
          <h2>Review Results</h2>
        </div>
        <p class="empty-note">Run a review to see field-by-field evidence.</p>
      </section>
    `;
  }

  return `
    <section class="panel result-panel" aria-live="polite">
      <div class="result-header">
        <div>
          <p class="eyebrow">Overall</p>
          <h2><span class="status large ${statusClass(review.overallStatus)}">${displayStatus(review.overallStatus)}</span></h2>
        </div>
        <div class="export-actions">
          <button class="secondary" data-action="export-json" type="button">Export JSON</button>
          <button class="secondary" data-action="export-csv" type="button">Export CSV</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Expected Application Value</th>
              <th>Extracted Label Evidence</th>
              <th>Status</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>${review.fields.map(fieldRow).join('')}</tbody>
        </table>
      </div>
      <details class="ocr-details">
        <summary>OCR text and processing details</summary>
        ${review.files
          .map(
            (file) => `
              <article class="ocr-card">
                <h3>${escapeHtml(file.name)}</h3>
                <p><strong>Engine:</strong> ${escapeHtml(file.ocrResult.engine)} · <strong>Time:</strong> ${escapeHtml(file.ocrResult.processingTimeMs)} ms</p>
                <pre>${escapeHtml(file.ocrResult.rawText || 'No OCR text returned.')}</pre>
              </article>
            `,
          )
          .join('')}
      </details>
    </section>
  `;
}

function progressPanel(state) {
  if (!state.isProcessing && !state.progress.length && !state.error) return '';
  return `
    <section class="progress-panel" aria-live="polite">
      ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ''}
      ${state.progress.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
    </section>
  `;
}

export function renderApp(state) {
  return `
    <main class="app-shell">
      <section class="top-band">
        <div class="title-block">
          <p class="eyebrow">Browser-local TTB prototype</p>
          <h1>Alcohol Label Reviewer</h1>
          <p>Compare label image evidence against expected COLA/application fields without uploading images or calling a cloud OCR API.</p>
        </div>
        <aside class="privacy-note">
          <strong>Local-only demo</strong>
          <span>Images are processed in this browser session. No backend, database, cloud OCR, or LLM service is used.</span>
        </aside>
      </section>

      <section class="workflow-grid">
        <div class="left-stack">
          <section class="panel upload-panel">
            <div class="panel-heading">
              <h2>1. Label Images</h2>
              <button class="secondary" data-action="load-sample" type="button">Load Sample Packet</button>
            </div>
            <label class="drop-zone" for="image-input" id="drop-zone">
              <input id="image-input" type="file" accept="image/png,image/jpeg,image/webp" multiple />
              <span class="drop-title">Drop front/back label images here</span>
              <span class="drop-subtitle">PNG, JPG/JPEG, or WebP. Multiple images are reviewed together as one label packet.</span>
            </label>
            ${imageList(state.images)}
            <div class="inline-actions">
              <button class="secondary" data-action="clear-images" type="button" ${state.images.length ? '' : 'disabled'}>Clear Images</button>
            </div>
          </section>

          <section class="panel form-panel">
            <div class="panel-heading">
              <h2>2. Expected Fields</h2>
              <button class="secondary" data-action="reset-old-tom" type="button">Use Required Fields</button>
            </div>
            <form id="expected-form">
              <label>
                ${FIELD_LABELS.brandName}
                <input name="brandName" autocomplete="off" value="${escapeHtml(state.expected.brandName)}" />
              </label>
              <label>
                ${FIELD_LABELS.classType}
                <input name="classType" autocomplete="off" value="${escapeHtml(state.expected.classType)}" />
              </label>
              <label>
                ${FIELD_LABELS.alcoholContent}
                <input name="alcoholContent" autocomplete="off" value="${escapeHtml(state.expected.alcoholContent)}" />
              </label>
              <label>
                ${FIELD_LABELS.netContents}
                <input name="netContents" autocomplete="off" value="${escapeHtml(state.expected.netContents)}" />
              </label>
              <label class="checkbox-line">
                <input name="governmentWarningRequired" type="checkbox" ${state.expected.governmentWarningRequired ? 'checked' : ''} />
                Government warning required
              </label>
              <div class="optional-grid">
                <label>
                  ${FIELD_LABELS.producerName}
                  <input name="producerName" autocomplete="off" value="${escapeHtml(state.expected.producerName)}" />
                </label>
                <label>
                  ${FIELD_LABELS.countryOfOrigin}
                  <input name="countryOfOrigin" autocomplete="off" value="${escapeHtml(state.expected.countryOfOrigin)}" />
                </label>
                <label>
                  ${FIELD_LABELS.applicationId}
                  <input name="applicationId" autocomplete="off" value="${escapeHtml(state.expected.applicationId)}" />
                </label>
                <label>
                  ${FIELD_LABELS.labelId}
                  <input name="labelId" autocomplete="off" value="${escapeHtml(state.expected.labelId)}" />
                </label>
              </div>
            </form>
          </section>
        </div>

        <div class="right-stack">
          <section class="review-actions">
            <button class="primary" data-action="run-review" type="button" ${state.images.length && !state.isProcessing ? '' : 'disabled'}>
              ${state.isProcessing ? 'Reviewing...' : 'Review Label'}
            </button>
          </section>
          ${progressPanel(state)}
          ${reviewPanel(state.review)}
        </div>
      </section>
    </main>
  `;
}

export { displayStatus };
