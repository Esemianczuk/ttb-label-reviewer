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
  if (state.currentMode === 'upload') return currentUploadRow(state)?.title || 'Uploaded application';
  return currentPacket(state)?.title || 'Sample application';
}

function currentUploadRow(state) {
  return state.uploadBatchRows[state.currentUploadBatchIndex] || null;
}

function effectiveStatus(field = {}) {
  return field.agentStatus || field.status || '';
}

function fieldStatus(review, label) {
  return (review?.fields || []).find((field) => field.field === label || field.fieldKey === label)?.status || '';
}

function reviewHasLowConfidence(review) {
  return (review?.fields || []).some((field) => Number.isFinite(field.confidence) && field.confidence < 0.65);
}

function criticalIssues(review) {
  return (review?.fields || [])
    .filter((field) => field.severity === 'critical' && ![STATUS.PASS].includes(effectiveStatus(field)))
    .map((field) => field.field)
    .join(', ');
}

function engineSummary(review) {
  return (
    review?.enginesUsed?.map((engine) => engine.displayName || engine.id || engine.engineId).join(', ') ||
    review?.files?.map((file) => file.ocrResult?.engine).filter(Boolean).join(', ') ||
    ''
  );
}

function durationText(ms) {
  if (!Number.isFinite(ms)) return '-';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function batchRows(state) {
  if (state.currentMode === 'upload' || state.uploadBatchRows.length) {
    return state.uploadBatchRows.map((row, index) => {
      const isCurrent = state.currentMode === 'upload' && row.id === currentUploadRow(state)?.id;
      const review = isCurrent ? state.review : row.review || row.applicationState?.review;
      const expected = isCurrent ? state.expected : row.expected || row.applicationState?.expected || {};
      const stats = isCurrent ? state.batchStats : row.applicationState?.batchStats;
      return {
        id: row.id,
        index,
        source: 'upload',
        title: row.title,
        applicationId: expected.applicationId || row.id,
        brand: expected.brandName || '-',
        classType: expected.classType || '-',
        overall: review?.overallStatus || row.status || 'ready',
        criticalIssues: criticalIssues(review) || row.criticalIssues || '-',
        processingMode: stats?.mode || row.processingMode || '-',
        workerEngine: engineSummary(review) || row.workerEngine || '-',
        durationMs: stats?.totalMs ?? row.durationMs,
        reviewerDecision: review?.overallStatus || row.reviewerDecision || '-',
        review,
        isCurrent,
        action: 'select-batch-row',
      };
    });
  }

  return state.samplePackets.map((packet, index) => {
    const isCurrent = state.currentMode === 'samples' && index === state.currentSampleIndex;
    const cached = isCurrent ? null : state.applicationStates[packet.id];
    const review = isCurrent ? state.review : cached?.review;
    const expected = isCurrent ? state.expected : cached?.expected || {};
    const stats = isCurrent ? state.batchStats : cached?.batchStats;
    return {
      id: packet.id,
      index,
      source: 'sample',
      title: packet.title,
      applicationId: expected.applicationId || packet.id,
      brand: expected.brandName || packet.title,
      classType: expected.classType || '-',
      overall: review?.overallStatus || (isCurrent || cached ? 'ready' : 'queued'),
      criticalIssues: criticalIssues(review) || '-',
      processingMode: stats?.mode || '-',
      workerEngine: engineSummary(review) || '-',
      durationMs: stats?.totalMs,
      reviewerDecision: review?.overallStatus || '-',
      review,
      isCurrent,
      action: 'select-sample-row',
    };
  });
}

function rowPriority(row) {
  const status = String(row.overall || '').toUpperCase();
  if (status === STATUS.FAIL || row.criticalIssues !== '-') return 0;
  if (status === STATUS.NEEDS_REVIEW || row.overall === 'needs_image') return 1;
  if ([STATUS.WARNING, STATUS.PASS_WITH_WARNINGS].includes(status)) return 2;
  if (reviewHasLowConfidence(row.review)) return 3;
  if (status === STATUS.PASS) return 4;
  return 5;
}

function rowMatchesFilter(row, filters) {
  const status = String(row.overall || '').toUpperCase();
  const matches = [];
  if (filters.fail) matches.push(status === STATUS.FAIL || row.criticalIssues !== '-');
  if (filters.needsReview) matches.push(status === STATUS.NEEDS_REVIEW || row.overall === 'needs_image');
  if (filters.warning) matches.push([STATUS.WARNING, STATUS.PASS_WITH_WARNINGS].includes(status));
  if (filters.pass) matches.push(status === STATUS.PASS);
  if (filters.missingWarning) matches.push([STATUS.FAIL, STATUS.NOT_FOUND, STATUS.NEEDS_REVIEW].includes(fieldStatus(row.review, 'Government Warning')));
  if (filters.abvMismatch) matches.push([STATUS.FAIL, STATUS.NOT_FOUND, STATUS.NEEDS_REVIEW].includes(fieldStatus(row.review, 'Alcohol Content')));
  if (filters.lowOcrConfidence) matches.push(reviewHasLowConfidence(row.review));
  return matches.some(Boolean) || (!row.review && ['ready', 'queued', 'needs_image'].includes(row.overall));
}

function filteredBatchRows(state) {
  const search = String(state.batchSearch || '').trim().toLowerCase();
  return batchRows(state)
    .filter((row) => rowMatchesFilter(row, state.batchFilters || {}))
    .filter((row) =>
      search
        ? [row.applicationId, row.brand, row.classType, row.title, row.overall].some((value) => String(value || '').toLowerCase().includes(search))
        : true,
    )
    .sort((left, right) => rowPriority(left) - rowPriority(right) || left.index - right.index);
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
  const history = field.history || [];
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
        <details class="field-history">
          <summary>Field history</summary>
          ${
            history.length
              ? history
                  .map(
                    (item) => `
                      <p>
                        <strong>${escapeHtml(item.actor || 'Review')}</strong>
                        <span>${escapeHtml(displayStatus(item.status))}</span>
                        <small>${escapeHtml(item.note || '')}</small>
                      </p>
                    `,
                  )
                  .join('')
              : '<p><small>No field history yet.</small></p>'
          }
        </details>
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
  const uploadRow = currentUploadRow(state);
  const isUpload = state.currentMode === 'upload';
  const count = isUpload ? state.uploadBatchRows.length : state.samplePackets.length;
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
        <p class="eyebrow">${
          isUpload
            ? `Uploaded application ${Math.min(state.currentUploadBatchIndex + 1, count || 1)} of ${count || 1}`
            : `Application ${Math.min(state.currentSampleIndex + 1, count || 1)} of ${count || 1}`
        }</p>
        <h2>${escapeHtml(currentApplicationTitle(state))}</h2>
        ${packet?.description && !isUpload ? `<p>${escapeHtml(packet.description)}</p>` : ''}
        ${uploadRow && isUpload ? `<p>${escapeHtml(uploadRow.images?.[0]?.name || uploadRow.criticalIssues || 'Uploaded manifest row')}</p>` : ''}
      </div>
      <div class="queue-controls">
        <select id="sample-select" ${state.samplePackets.length ? '' : 'disabled'} aria-label="Sample application">
          ${sampleOptions || '<option>Loading samples...</option>'}
        </select>
        <button class="secondary" data-action="previous-sample" type="button" ${
          (isUpload && state.currentUploadBatchIndex > 0) || (!isUpload && state.currentSampleIndex > 0) ? '' : 'disabled'
        }>Previous</button>
        <button class="primary queue-next" data-action="next-sample" type="button" ${
          (isUpload && state.currentUploadBatchIndex < count - 1) || (!isUpload && state.currentSampleIndex < count - 1) ? '' : 'disabled'
        }>Next Application</button>
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

function backendStatusText(state) {
  if (state.processingMode === 'browser') return 'Browser only';
  if (state.backendStatus === 'online') return state.streamConnected ? 'Backend online, stream connected' : 'Backend online';
  if (state.backendStatus === 'checking') return 'Checking backend';
  return 'Backend offline, browser fallback ready';
}

function processingModePanel(state) {
  return `
    <section class="processing-panel" aria-label="Processing controls">
      <div class="mode-line">
        <label>
          Processing Mode
          <select id="processing-mode-select" ${state.isProcessing ? 'disabled' : ''}>
            <option value="browser" ${state.processingMode === 'browser' ? 'selected' : ''}>Browser Only</option>
            <option value="backend" ${state.processingMode === 'backend' ? 'selected' : ''}>Local Backend</option>
            <option value="cluster" ${state.processingMode === 'cluster' ? 'selected' : ''}>Cluster</option>
          </select>
        </label>
        <label>
          Backend URL
          <input id="backend-url-input" value="${escapeHtml(state.backendUrl)}" ${state.isProcessing ? 'disabled' : ''} />
        </label>
        <button class="secondary" data-action="refresh-backend" type="button">Refresh</button>
      </div>
      <div class="mode-status">
        <span class="connection-dot ${escapeHtml(state.backendStatus)}"></span>
        <strong>${escapeHtml(backendStatusText(state))}</strong>
        <span>${escapeHtml(state.backendMessage || '')}</span>
      </div>
      <div class="mode-metrics">
        <span>${escapeHtml(state.workerCount)} browser worker${state.workerCount === 1 ? '' : 's'} ready</span>
        <span>${escapeHtml(state.clusterWorkers.length)} backend worker${state.clusterWorkers.length === 1 ? '' : 's'} seen</span>
        <span>Session ${escapeHtml(state.backendSessionId || 'browser-local')}</span>
      </div>
    </section>
  `;
}

function batchFilter(label, name, checked) {
  return `
    <label class="filter-pill">
      <input class="batch-filter" name="${escapeHtml(name)}" type="checkbox" ${checked ? 'checked' : ''} />
      ${escapeHtml(label)}
    </label>
  `;
}

function batchQueuePanel(state) {
  const rows = filteredBatchRows(state);
  const filters = state.batchFilters || {};
  return `
    <section class="panel queue-table-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Severity-first queue</p>
          <h2>Application Packets</h2>
        </div>
        <label class="queue-search">
          Search
          <input id="batch-search" value="${escapeHtml(state.batchSearch)}" placeholder="Application, brand, class/type" />
        </label>
      </div>
      <div class="filter-row">
        ${batchFilter('Fail', 'fail', filters.fail)}
        ${batchFilter('Needs Review', 'needsReview', filters.needsReview)}
        ${batchFilter('Warning', 'warning', filters.warning)}
        ${batchFilter('Pass', 'pass', filters.pass)}
        ${batchFilter('Missing warning', 'missingWarning', filters.missingWarning)}
        ${batchFilter('ABV mismatch', 'abvMismatch', filters.abvMismatch)}
        ${batchFilter('Low OCR confidence', 'lowOcrConfidence', filters.lowOcrConfidence)}
      </div>
      <div class="table-wrap batch-table-wrap">
        <table class="batch-table">
          <thead>
            <tr>
              <th>Application ID</th>
              <th>Brand</th>
              <th>Class/Type</th>
              <th>Overall</th>
              <th>Critical Issues</th>
              <th>Processing Mode</th>
              <th>Worker/Engine</th>
              <th>Time</th>
              <th>Reviewer Decision</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows
                    .slice(0, 120)
                    .map(
                      (row) => `
                        <tr class="${row.isCurrent ? 'is-current-row' : ''}">
                          <th scope="row" data-label="Application ID">
                            <button class="row-link" data-action="${escapeHtml(row.action)}" ${
                              row.source === 'upload'
                                ? `data-batch-row-id="${escapeHtml(row.id)}"`
                                : `data-sample-index="${escapeHtml(row.index)}"`
                            } type="button">${escapeHtml(row.applicationId)}</button>
                          </th>
                          <td data-label="Brand">${escapeHtml(row.brand)}</td>
                          <td data-label="Class/Type">${escapeHtml(row.classType)}</td>
                          <td data-label="Overall"><span class="status ${statusClass(row.overall)}">${escapeHtml(displayStatus(row.overall))}</span></td>
                          <td data-label="Critical Issues">${escapeHtml(row.criticalIssues)}</td>
                          <td data-label="Processing Mode">${escapeHtml(row.processingMode)}</td>
                          <td data-label="Worker/Engine">${escapeHtml(row.workerEngine)}</td>
                          <td data-label="Time">${escapeHtml(durationText(row.durationMs))}</td>
                          <td data-label="Reviewer Decision">${escapeHtml(displayStatus(row.reviewerDecision))}</td>
                        </tr>
                      `,
                    )
                    .join('')
                : '<tr><td colspan="9">No applications match the active filters.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function acceleratorText(worker) {
  const accelerators = worker.capabilities?.accelerators || {};
  const parts = [];
  if (accelerators.cuda?.available) parts.push('CUDA');
  if (accelerators.appleMps?.available) parts.push('MPS');
  return parts.join(', ') || 'CPU';
}

function enginesText(worker) {
  const engines = worker.capabilities?.engines || {};
  const available = Object.entries(engines)
    .filter(([, value]) => value?.available)
    .map(([key]) => key);
  return available.join(', ') || worker.capabilities?.warmEngines?.join(', ') || 'null';
}

function relativeTime(value) {
  if (!value) return '-';
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return '-';
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  return `${Math.round(ms / 3600000)}h ago`;
}

function throughputStats(state) {
  const rows = batchRows(state).filter((row) => row.review);
  const durations = rows.map((row) => row.durationMs).filter(Number.isFinite).sort((a, b) => a - b);
  const counts = rows.reduce(
    (accumulator, row) => {
      const status = String(row.overall || '').toUpperCase();
      if (status === STATUS.PASS) accumulator.pass += 1;
      else if (status === STATUS.NEEDS_REVIEW) accumulator.needsReview += 1;
      else if (status === STATUS.FAIL) accumulator.fail += 1;
      return accumulator;
    },
    { pass: 0, needsReview: 0, fail: 0 },
  );
  const totalMs = durations.reduce((sum, value) => sum + value, 0);
  return {
    imagesPerMinute: totalMs ? Math.round((rows.length / totalMs) * 60000 * 10) / 10 : 0,
    p50: percentile(durations, 0.5),
    p95: percentile(durations, 0.95),
    counts,
  };
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const index = Math.min(values.length - 1, Math.floor((values.length - 1) * fraction));
  return values[index];
}

function schedulerReason(event) {
  const assignment = event.payload?.assignment || {};
  const reasons = assignment.reason_codes || assignment.reasonCodes || [];
  return reasons.length ? reasons.join(', ') : event.eventType.replaceAll('_', ' ');
}

function clusterDashboard(state) {
  const stats = throughputStats(state);
  return `
    <section class="cluster-dashboard">
      <div class="panel cluster-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Cluster dashboard</p>
            <h2>Worker Agents</h2>
          </div>
          <span class="status ${state.backendStatus === 'online' ? 'pass' : 'needs-review'}">${escapeHtml(state.backendStatus)}</span>
        </div>
        <div class="worker-card-grid">
          ${
            state.clusterWorkers.length
              ? state.clusterWorkers
                  .map(
                    (worker) => `
                      <article class="worker-card">
                        <div>
                          <strong>${escapeHtml(worker.hostname || worker.id)}</strong>
                          <span>${escapeHtml(worker.platform)} ${escapeHtml(worker.arch)}</span>
                        </div>
                        <dl>
                          <div><dt>CPU</dt><dd>${escapeHtml(worker.capabilities?.cpuCount || '-')} cores</dd></div>
                          <div><dt>GPU</dt><dd>${escapeHtml(acceleratorText(worker))}</dd></div>
                          <div><dt>Engines</dt><dd>${escapeHtml(enginesText(worker))}</dd></div>
                          <div><dt>Active</dt><dd>${escapeHtml(worker.activeJobs || 0)} / ${escapeHtml(worker.maxConcurrency || 1)}</dd></div>
                          <div><dt>Queue depth</dt><dd>${escapeHtml(worker.capabilities?.queueDepth ?? '-')}</dd></div>
                          <div><dt>Avg ms/image</dt><dd>${escapeHtml(Math.round(worker.calibration?.engines?.null?.ocrMs || worker.calibration?.ocrMs || 0) || '-')}</dd></div>
                          <div><dt>Heartbeat</dt><dd>${escapeHtml(relativeTime(worker.lastSeenAt))}</dd></div>
                          <div><dt>Status</dt><dd>${escapeHtml(worker.status)}</dd></div>
                        </dl>
                      </article>
                    `,
                  )
                  .join('')
              : '<p class="empty-note">No backend workers have registered yet.</p>'
          }
        </div>
      </div>

      <div class="panel throughput-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Throughput</p>
            <h2>Review Flow</h2>
          </div>
        </div>
        <div class="throughput-grid">
          <span><strong>${escapeHtml(stats.imagesPerMinute)}</strong> images/min</span>
          <span><strong>${escapeHtml(durationText(stats.p50))}</strong> p50</span>
          <span><strong>${escapeHtml(durationText(stats.p95))}</strong> p95</span>
          <span><strong>${escapeHtml(stats.counts.fail)}</strong> fail</span>
          <span><strong>${escapeHtml(stats.counts.needsReview)}</strong> needs review</span>
          <span><strong>${escapeHtml(stats.counts.pass)}</strong> pass</span>
        </div>
        <div class="scheduler-log">
          <h3>Scheduler Explanation</h3>
          ${
            state.clusterEvents.length
              ? state.clusterEvents
                  .slice(0, 8)
                  .map(
                    (event) => `
                      <p>
                        <strong>${escapeHtml(event.workerId)}</strong>
                        <span>${escapeHtml(schedulerReason(event))}</span>
                      </p>
                    `,
                  )
                  .join('')
              : '<p class="empty-note">Assignments will appear after workers claim jobs.</p>'
          }
        </div>
      </div>
    </section>
  `;
}

function operationsDashboard(state) {
  return `
    <section class="operations-dashboard">
      ${batchQueuePanel(state)}
      ${clusterDashboard(state)}
    </section>
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
          <p class="eyebrow">Hybrid TTB review workspace</p>
          <h1>Alcohol Label Reviewer</h1>
          <p>Agent queue for matching one application image against expected COLA fields, evidence, and reviewer decisions across browser, local backend, and cluster modes.</p>
        </div>
        <aside class="privacy-note">
          <strong>Demo controls</strong>
          <span>Browser mode is always available. Backend modes use the configured coordinator when it is online.</span>
          <button class="secondary reset-demo" data-action="reset-demo" type="button">Reset Demo</button>
        </aside>
      </section>

      ${sampleQueueBar(state)}
      ${processingModePanel(state)}
      ${operationsDashboard(state)}

      <section class="workflow-grid">
        <div class="left-stack">
          <section class="panel upload-panel">
            <div class="panel-heading">
              <h2>Application Image${state.images.length > 1 ? 's' : ''}</h2>
            </div>
            <label class="drop-zone" for="image-input" id="drop-zone">
              <input id="image-input" type="file" accept="image/png,image/jpeg,image/webp,text/csv,.csv" multiple />
              <span class="drop-title">Drop images or a CSV manifest</span>
              <span class="drop-subtitle">Each row becomes one application. Image filenames are matched to manifest filename, labelId, or file columns.</span>
            </label>
            <div class="inline-actions">
              <button class="secondary" data-action="trigger-upload" type="button">Choose Files</button>
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
                ? `<p class="worker-note">Requested mode: ${escapeHtml(state.processingMode)}. Effective worker count updates as results arrive.</p>`
                : ''
            }
            <div class="review-nav">
              <button class="secondary" data-action="previous-sample" type="button" ${
                (state.currentMode === 'upload' && state.currentUploadBatchIndex > 0) ||
                (state.currentMode === 'samples' && state.currentSampleIndex > 0)
                  ? ''
                  : 'disabled'
              }>Previous</button>
              <button class="secondary" data-action="next-sample" type="button" ${
                (state.currentMode === 'upload' && state.currentUploadBatchIndex < state.uploadBatchRows.length - 1) ||
                (state.currentMode === 'samples' && state.currentSampleIndex < state.samplePackets.length - 1)
                  ? ''
                  : 'disabled'
              }>Next Application</button>
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
