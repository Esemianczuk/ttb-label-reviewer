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

function imageStatusLabel(status) {
  return {
    ready: 'Ready',
    queued: 'Queued',
    processing: 'Processing',
    done: 'Done',
    error: 'Error',
  }[status] || 'Ready';
}

function imageList(images, state) {
  if (!images.length) {
    return '<p class="empty-note">No label images selected.</p>';
  }
  return `
    <div class="image-list ${state.isProcessing ? 'is-processing' : ''}">
      ${images
        .map((image) => {
          const status = state.imageStatuses[image.id] || { status: 'ready', message: 'Ready' };
          const activeClass = status.status === 'processing' ? 'is-active' : 'is-muted';
          return `
            <figure class="image-thumb ${state.isProcessing ? activeClass : ''} status-${escapeHtml(status.status)}">
              <div class="image-preview">
              <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.name)} preview" />
                ${
                  state.isProcessing
                    ? `<div class="image-overlay">
                        ${status.status === 'processing' ? '<span class="spinner" aria-hidden="true"></span>' : ''}
                        <span>${escapeHtml(imageStatusLabel(status.status))}</span>
                      </div>`
                    : ''
                }
              </div>
              <figcaption>
                <strong>${escapeHtml(image.name)}</strong>
                <span>${image.source === 'sample' ? 'Sample packet' : image.source === 'generated' ? 'Custom generated' : `${Math.round((image.size || 0) / 1024)} KB`}</span>
                <span class="image-status">${escapeHtml(status.message || imageStatusLabel(status.status))}</span>
                <button class="icon-button" data-action="remove-image" data-image-id="${escapeHtml(image.id)}" type="button" aria-label="Remove ${escapeHtml(image.name)}">Remove</button>
              </figcaption>
            </figure>
          `;
        })
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
                ${
                  file.ocrResult.variants?.length
                    ? `<div class="variant-list">
                        ${file.ocrResult.variants
                          .map(
                            (variant) => `
                              <span>${escapeHtml(variant.label)}: ${escapeHtml(variant.textLength)} chars</span>
                            `,
                          )
                          .join('')}
                      </div>`
                    : ''
                }
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

function ocrEngineOptions(state) {
  const selected = state.ocrEngine || 'easyocr';
  return `
    <label class="engine-picker">
      OCR Engine
      <select id="ocr-engine-select" ${state.isProcessing ? 'disabled' : ''}>
        <option value="easyocr" ${selected === 'easyocr' ? 'selected' : ''}>EasyOCR local service</option>
        <option value="tesseract" ${selected === 'tesseract' ? 'selected' : ''}>Browser Tesseract.js</option>
      </select>
    </label>
  `;
}

export function renderApp(state) {
  const sampleOptions = state.samplePackets
    .map(
      (packet) => `
        <option value="${escapeHtml(packet.id)}" ${packet.id === state.selectedSampleId ? 'selected' : ''}>
          ${escapeHtml(packet.title)}
        </option>
      `,
    )
    .join('');

  return `
    <main class="app-shell">
      <section class="top-band">
        <div class="title-block">
          <p class="eyebrow">Browser-local TTB prototype</p>
          <h1>Alcohol Label Reviewer</h1>
          <p>Compare label image evidence against expected COLA/application fields using local OCR and deterministic review rules.</p>
        </div>
        <aside class="privacy-note">
          <strong>Local OCR demo</strong>
          <span>Images stay on this machine. EasyOCR runs through localhost; Tesseract runs in the browser.</span>
        </aside>
      </section>

      <section class="workflow-grid">
        <div class="left-stack">
          <section class="panel upload-panel">
            <div class="panel-heading">
              <h2>1. Label Images</h2>
            </div>
            <div class="sample-picker">
              <label>
                Sample Library
                <select id="sample-select" ${state.samplePackets.length ? '' : 'disabled'}>
                  ${sampleOptions || '<option>Loading samples...</option>'}
                </select>
              </label>
              <button class="secondary" data-action="load-sample" type="button" ${state.samplePackets.length ? '' : 'disabled'}>Load Sample Packet</button>
            </div>
            <label class="drop-zone" for="image-input" id="drop-zone">
              <input id="image-input" type="file" accept="image/png,image/jpeg,image/webp" multiple />
              <span class="drop-title">Drop front/back label images here</span>
              <span class="drop-subtitle">PNG, JPG/JPEG, or WebP. Multiple images are reviewed together as one label packet.</span>
            </label>
            <div class="inline-actions">
              <button class="secondary" data-action="trigger-upload" type="button">Choose Images</button>
              <button class="secondary" data-action="clear-images" type="button" ${state.images.length ? '' : 'disabled'}>Clear Images</button>
            </div>
            ${imageList(state.images, state)}
            <div class="inline-actions">
              <button class="secondary" data-action="create-custom" type="button">Create Custom Label Images</button>
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
            ${ocrEngineOptions(state)}
            <button class="primary" data-action="run-review" type="button" ${state.images.length && !state.isProcessing ? '' : 'disabled'}>
              ${state.isProcessing ? 'Reviewing...' : 'Review Label'}
            </button>
            ${
              state.isProcessing
                ? `<p class="worker-note">Using up to ${escapeHtml(state.workerCount)} local OCR worker${state.workerCount === 1 ? '' : 's'}.</p>`
                : ''
            }
          </section>
          ${progressPanel(state)}
          ${reviewPanel(state.review)}
        </div>
      </section>
    </main>
  `;
}

export { displayStatus };
