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
    [STATUS.FAIL]: 'Fail',
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

function currentPacket(state) {
  return state.samplePackets[state.currentSampleIndex] || null;
}

function currentApplicationTitle(state) {
  if (state.currentMode === 'upload') return 'Uploaded application';
  return currentPacket(state)?.title || 'Sample application';
}

function imageList(images, state) {
  if (!images.length) {
    return '<p class="empty-note">No application image selected.</p>';
  }

  return `
    <div class="image-list ${images.length === 1 ? 'single' : 'multi'} ${state.isProcessing ? 'is-processing' : ''}">
      ${images
        .map((image) => {
          const status = state.imageStatuses[image.id] || { status: 'ready', message: 'Ready' };
          const activeClass = status.status === 'processing' ? 'is-active' : 'is-muted';
          const canRemove = image.source !== 'sample';
          return `
            <figure class="image-thumb application-image ${state.isProcessing ? activeClass : ''} status-${escapeHtml(status.status)}">
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
                <span>${image.source === 'sample' ? 'Loaded from sample queue' : image.source === 'generated' ? 'Custom generated' : `${Math.round((image.size || 0) / 1024)} KB`}</span>
                <span class="image-status">${escapeHtml(status.message || imageStatusLabel(status.status))}</span>
                <div class="image-actions">
                  <button class="secondary small-button" data-action="open-viewer" data-image-id="${escapeHtml(image.id)}" type="button">Expand Image</button>
                  ${
                    canRemove
                      ? `<button class="secondary small-button" data-action="remove-image" data-image-id="${escapeHtml(image.id)}" type="button">Remove</button>`
                      : ''
                  }
                </div>
              </figcaption>
            </figure>
          `;
        })
        .join('')}
    </div>
  `;
}

function evidenceCell(field) {
  const crops = field.evidenceCrops || [];
  return `
    <div class="evidence-cell">
      <p>${escapeHtml(field.extracted || 'No evidence found')}</p>
      ${
        crops.length
          ? `<div class="evidence-crops">
              ${crops
                .map(
                  (crop) => `
                    <figure class="evidence-crop">
                      <img src="${escapeHtml(crop.src)}" alt="${escapeHtml(`Evidence crop from ${crop.imageName}`)}" loading="lazy" />
                      <figcaption>
                        <span>${escapeHtml(crop.imageName)}</span>
                        <small>${escapeHtml(crop.text)}</small>
                      </figcaption>
                    </figure>
                  `,
                )
                .join('')}
            </div>`
          : ''
      }
    </div>
  `;
}

function decisionOptions(selected) {
  return [STATUS.PASS, STATUS.FAIL, STATUS.NEEDS_REVIEW, STATUS.WARNING, STATUS.NOT_FOUND]
    .map(
      (status) => `
        <option value="${escapeHtml(status)}" ${status === selected ? 'selected' : ''}>${escapeHtml(displayStatus(status))}</option>
      `,
    )
    .join('');
}

function fieldRow(field, index) {
  const agentStatus = field.agentStatus || field.status;
  const wasChanged = agentStatus !== field.status || field.agentNote;
  return `
    <tr class="${wasChanged ? 'has-agent-edit' : ''}">
      <th scope="row">${escapeHtml(field.field)}</th>
      <td data-label="Expected">${escapeHtml(field.expected)}</td>
      <td data-label="Evidence">${evidenceCell(field)}</td>
      <td data-label="Auto Status">
        <span class="status ${statusClass(field.status)}">${displayStatus(field.status)}</span>
        <p class="reason-copy">${escapeHtml(field.reason)}</p>
        <small>${escapeHtml(confidenceText(field.confidence))}</small>
      </td>
      <td data-label="Agent Decision">
        <label class="decision-label">
          <span>Decision</span>
          <select class="decision-select" data-review-field-index="${index}">
            ${decisionOptions(agentStatus)}
          </select>
        </label>
        <label class="decision-label">
          <span>Notes / reasoning</span>
          <textarea class="agent-note" data-review-field-index="${index}" rows="4" placeholder="Add reviewer notes">${escapeHtml(field.agentNote || '')}</textarea>
        </label>
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
        <p class="empty-note">Auto review starts when a sample application loads. Uploaded images can be reviewed after one image and expected fields are present.</p>
      </section>
    `;
  }

  return `
    <section class="panel result-panel" aria-live="polite">
      <div class="result-header">
        <div>
          <p class="eyebrow">Final Decision</p>
          <h2><span class="status large ${statusClass(review.overallStatus)}">${displayStatus(review.overallStatus)}</span></h2>
        </div>
        <div class="export-actions">
          <button class="secondary" data-action="export-pdf" type="button">Download PDF</button>
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
              <th>Auto Status</th>
              <th>Agent Decision</th>
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
                              <span>${escapeHtml(variant.label)}: ${escapeHtml(variant.textLength)} chars${variant.durationMs ? `, ${escapeHtml(variant.durationMs)} ms` : ''}</span>
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
      ${
        state.batchStats
          ? `<p class="batch-stats">
              ${escapeHtml(state.batchStats.imageCount)} image${state.batchStats.imageCount === 1 ? '' : 's'} ·
              ${escapeHtml(state.batchStats.workerCount)} worker${state.batchStats.workerCount === 1 ? '' : 's'} ·
              ${escapeHtml(state.batchStats.totalMs)} ms ·
              ${escapeHtml(state.batchStats.imagesPerMinute)} images/min
            </p>`
          : ''
      }
      ${state.progress.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
    </section>
  `;
}

function sampleQueueBar(state) {
  const packet = currentPacket(state);
  const count = state.samplePackets.length;
  const sampleOptions = state.samplePackets
    .map(
      (item, index) => `
        <option value="${escapeHtml(item.id)}" ${item.id === state.selectedSampleId ? 'selected' : ''}>
          ${index + 1}. ${escapeHtml(item.title)}
        </option>
      `,
    )
    .join('');

  return `
    <section class="queue-bar">
      <div>
        <p class="eyebrow">${state.currentMode === 'samples' ? `Application ${Math.min(state.currentSampleIndex + 1, count || 1)} of ${count || 1}` : 'Custom application'}</p>
        <h2>${escapeHtml(currentApplicationTitle(state))}</h2>
        ${packet?.description && state.currentMode === 'samples' ? `<p>${escapeHtml(packet.description)}</p>` : ''}
      </div>
      <div class="queue-controls">
        <select id="sample-select" ${count ? '' : 'disabled'} aria-label="Sample application">
          ${sampleOptions || '<option>Loading samples...</option>'}
        </select>
        <button class="secondary" data-action="previous-sample" type="button" ${state.currentMode === 'samples' && state.currentSampleIndex > 0 ? '' : 'disabled'}>Previous</button>
        <button class="primary queue-next" data-action="next-sample" type="button" ${state.currentMode === 'samples' && state.currentSampleIndex < count - 1 ? '' : 'disabled'}>Next Application</button>
      </div>
    </section>
  `;
}

function expectedFieldsForm(state) {
  return `
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
  `;
}

function floatingViewer(state) {
  if (!state.viewer.open) return '';
  const image = state.images.find((entry) => entry.id === state.viewer.imageId) || state.images[0];
  if (!image) return '';
  const style = [
    `left:${Math.round(state.viewer.left)}px`,
    `top:${Math.round(state.viewer.top)}px`,
    `width:${Math.round(state.viewer.width)}px`,
    `height:${Math.round(state.viewer.height)}px`,
  ].join(';');
  const imageStyle = `transform: translate(${Math.round(state.viewer.panX)}px, ${Math.round(state.viewer.panY)}px) scale(${state.viewer.zoom});`;

  return `
    <section class="floating-viewer" id="floating-viewer" style="${style}" aria-label="Expanded application image viewer">
      <div class="floating-viewer-header" id="floating-viewer-header">
        <strong>${escapeHtml(image.name)}</strong>
        <div class="viewer-actions">
          <button class="secondary small-button" data-action="viewer-zoom-out" type="button">-</button>
          <button class="secondary small-button" data-action="viewer-reset-view" type="button">Reset</button>
          <button class="secondary small-button" data-action="viewer-zoom-in" type="button">+</button>
          <button class="secondary small-button" data-action="close-viewer" type="button">Close</button>
        </div>
      </div>
      <div class="floating-viewer-body" id="floating-viewer-body">
        <img id="floating-viewer-image" src="${escapeHtml(image.url)}" alt="${escapeHtml(image.name)} expanded view" style="${imageStyle}" draggable="false" />
      </div>
    </section>
  `;
}

export function renderApp(state) {
  return `
    <main class="app-shell">
      <section class="top-band">
        <div class="title-block">
          <p class="eyebrow">Browser-only TTB prototype</p>
          <h1>Alcohol Label Reviewer</h1>
          <p>Agent queue and browser batch reviewer for matching application images against expected COLA fields, evidence, and reviewer decisions.</p>
        </div>
        <aside class="privacy-note">
          <strong>Static browser demo</strong>
          <span>Images stay in the browser. No backend service is required.</span>
          <button class="secondary reset-demo" data-action="reset-demo" type="button">Reset Demo</button>
        </aside>
      </section>

      ${sampleQueueBar(state)}

      <section class="workflow-grid">
        <div class="left-stack">
          <section class="panel upload-panel">
            <div class="panel-heading">
              <h2>Application Image${state.images.length > 1 ? 's' : ''}</h2>
            </div>
            <label class="drop-zone" for="image-input" id="drop-zone">
              <input id="image-input" type="file" accept="image/png,image/jpeg,image/webp" multiple />
              <span class="drop-title">Drop application image${state.currentMode === 'upload' ? 's' : ''}</span>
              <span class="drop-subtitle">PNG, JPG/JPEG, or WebP. The expected fields apply to the uploaded batch.</span>
            </label>
            <div class="inline-actions">
              <button class="secondary" data-action="trigger-upload" type="button">Choose Images</button>
              <button class="secondary" data-action="clear-images" type="button" ${state.images.length && state.currentMode === 'upload' ? '' : 'disabled'}>Clear Images</button>
              <button class="secondary" data-action="return-samples" type="button" ${state.currentMode === 'upload' && state.samplePackets.length ? '' : 'disabled'}>Sample Queue</button>
            </div>
            ${imageList(state.images, state)}
          </section>

          <section class="panel form-panel">
            <div class="panel-heading">
              <h2>Expected TTB Fields</h2>
              <button class="secondary" data-action="clear-fields" type="button">Clear Fields</button>
            </div>
            ${expectedFieldsForm(state)}
          </section>
        </div>

        <div class="right-stack">
          <section class="review-actions">
            <button class="primary" data-action="run-review" type="button" ${state.images.length && !state.isProcessing ? '' : 'disabled'}>
              ${state.isProcessing ? 'Reviewing...' : 'Auto Review'}
            </button>
            <div class="worker-controls">
              <label>
                Browser OCR workers
                <select id="worker-count-select" ${state.isProcessing ? 'disabled' : ''}>
                  <option value="auto" ${state.workerOverride === 'auto' ? 'selected' : ''}>Auto</option>
                  <option value="1" ${state.workerOverride === '1' ? 'selected' : ''}>1</option>
                  <option value="2" ${state.workerOverride === '2' ? 'selected' : ''}>2</option>
                  <option value="3" ${state.workerOverride === '3' ? 'selected' : ''}>3</option>
                </select>
              </label>
              <button class="secondary" data-action="cancel-review" type="button" ${state.isProcessing ? '' : 'disabled'}>Cancel</button>
            </div>
            ${
              state.isProcessing
                ? `<p class="worker-note">Using ${escapeHtml(state.workerCount)} browser OCR worker${state.workerCount === 1 ? '' : 's'} for this run.</p>`
                : ''
            }
            <div class="review-nav">
              <button class="secondary" data-action="previous-sample" type="button" ${state.currentMode === 'samples' && state.currentSampleIndex > 0 ? '' : 'disabled'}>Previous</button>
              <button class="secondary" data-action="next-sample" type="button" ${state.currentMode === 'samples' && state.currentSampleIndex < state.samplePackets.length - 1 ? '' : 'disabled'}>Next Application</button>
            </div>
          </section>
          ${progressPanel(state)}
          ${reviewPanel(state.review)}
        </div>
      </section>
      ${floatingViewer(state)}
    </main>
  `;
}

export { displayStatus };
