import './styles.css';
import { cloneExpectedFields, createInitialState } from './app-state.js';
import { attachEvidenceCrops } from './evidence/evidence-crops.js';
import { filesToImageEntries, revokeImageEntryUrls } from './ui/drag-drop.js';
import { exportCsvSummary, exportJsonReport, exportPdfReport } from './ui/export.js';
import { fixtureForImageEntry, loadSampleManifest, loadSamplePacket } from './ui/sample-data.js';
import { renderApp } from './ui/render.js';
import { validateLabelPacket } from './validation/overall.js';
import { STATUS } from './validation/status.js';
import { BrowserOcrWorkerPool, getRecommendedBrowserOcrWorkerCount } from './workers/browser-worker-pool.js';

const app = document.querySelector('#app');
const state = createInitialState();
const ocrWorkerPool = new BrowserOcrWorkerPool();
let activeReviewAbortController = null;

function blankExpectedFields() {
  return cloneExpectedFields({
    brandName: '',
    classType: '',
    alcoholContent: '',
    netContents: '',
    governmentWarningRequired: true,
    producerName: '',
    countryOfOrigin: '',
    applicationId: '',
    labelId: '',
  });
}

function currentPacket() {
  return state.samplePackets[state.currentSampleIndex] || null;
}

function currentApplicationMeta() {
  const packet = currentPacket();
  return {
    mode: state.currentMode,
    packetId: state.currentMode === 'samples' ? packet?.id || '' : '',
    title: state.currentMode === 'samples' ? packet?.title || 'Sample application' : 'Uploaded application',
    queuePosition: state.currentMode === 'samples' ? state.currentSampleIndex + 1 : null,
    queueTotal: state.currentMode === 'samples' ? state.samplePackets.length : null,
  };
}

function syncExpectedFromForm() {
  const form = document.querySelector('#expected-form');
  if (!form) return;
  const formData = new FormData(form);
  state.expected = cloneExpectedFields({
    brandName: formData.get('brandName'),
    classType: formData.get('classType'),
    alcoholContent: formData.get('alcoholContent'),
    netContents: formData.get('netContents'),
    governmentWarningRequired: formData.get('governmentWarningRequired') === 'on',
    producerName: formData.get('producerName'),
    countryOfOrigin: formData.get('countryOfOrigin'),
    applicationId: formData.get('applicationId'),
    labelId: formData.get('labelId'),
  });
}

function createImageStatuses(entries, status = 'ready', message = 'Ready') {
  return Object.fromEntries(entries.map((entry) => [entry.id, { status, message }]));
}

function snapshotCurrentApplication() {
  return {
    expected: cloneExpectedFields(state.expected),
    images: state.images,
    imageStatuses: { ...state.imageStatuses },
    review: state.review,
    workerCount: state.workerCount,
    workerOverride: state.workerOverride,
    batchStats: state.batchStats,
    progress: [...state.progress],
    error: state.error,
  };
}

function persistCurrentApplicationState({ syncForm = true } = {}) {
  if (state.currentMode !== 'samples' || !state.currentPacketId) return;
  if (syncForm) syncExpectedFromForm();
  state.applicationStates = {
    ...state.applicationStates,
    [state.currentPacketId]: snapshotCurrentApplication(),
  };
}

function applyApplicationState(applicationState) {
  revokeImageEntryUrls(state.images);
  state.expected = cloneExpectedFields(applicationState.expected);
  state.images = applicationState.images || [];
  state.imageStatuses = { ...(applicationState.imageStatuses || createImageStatuses(state.images)) };
  state.review = applicationState.review || null;
  state.workerCount = applicationState.workerCount || 1;
  state.workerOverride = applicationState.workerOverride || state.workerOverride || 'auto';
  state.batchStats = applicationState.batchStats || null;
  state.progress = [...(applicationState.progress || [])];
  state.error = applicationState.error || '';
}

function closeViewer() {
  state.viewer = { ...state.viewer, open: false };
}

function setImages(entries) {
  revokeImageEntryUrls(state.images);
  state.images = entries;
  state.imageStatuses = createImageStatuses(entries);
  state.review = null;
  state.error = '';
  state.progress = [];
  state.batchStats = null;
  closeViewer();
}

function removeImage(imageId) {
  const image = state.images.find((entry) => entry.id === imageId);
  if (image) revokeImageEntryUrls([image]);
  state.images = state.images.filter((entry) => entry.id !== imageId);
  const nextStatuses = { ...state.imageStatuses };
  delete nextStatuses[imageId];
  state.imageStatuses = nextStatuses;
  state.review = null;
  closeViewer();
}

function appendProgress(line) {
  state.progress = [...state.progress.slice(-5), line];
  render();
}

function setImageStatus(imageId, status, message) {
  state.imageStatuses = {
    ...state.imageStatuses,
    [imageId]: { status, message },
  };
  render();
}

function effectiveFieldStatus(field) {
  return field.agentStatus || field.status;
}

function computeReviewerOverall(fields) {
  const statuses = fields.map(effectiveFieldStatus);
  if (statuses.some((status) => status === STATUS.FAIL || status === STATUS.NOT_FOUND)) return STATUS.FAIL;
  if (statuses.some((status) => status === STATUS.NEEDS_REVIEW)) return STATUS.NEEDS_REVIEW;
  if (statuses.some((status) => status === STATUS.WARNING)) return STATUS.PASS_WITH_WARNINGS;
  return STATUS.PASS;
}

function initializeReviewerFields(review) {
  const fields = review.fields.map((field) => ({
    ...field,
    agentStatus: field.agentStatus || field.status,
    agentNote: field.agentNote || '',
  }));
  return {
    ...review,
    fields,
    overallStatus: computeReviewerOverall(fields),
    expectedApplication: cloneExpectedFields(state.expected),
    application: currentApplicationMeta(),
  };
}

function refreshReviewOverall() {
  if (!state.review) return;
  state.review = {
    ...state.review,
    overallStatus: computeReviewerOverall(state.review.fields),
    expectedApplication: cloneExpectedFields(state.expected),
    application: currentApplicationMeta(),
  };
}

function addUploadedFiles(files) {
  persistCurrentApplicationState();
  syncExpectedFromForm();
  const entries = filesToImageEntries(files);
  if (!entries.length) {
    state.error = 'No supported image files were selected. Use PNG, JPG/JPEG, or WebP.';
    render();
    return;
  }

  state.currentMode = 'upload';
  state.currentPacketId = '';
  state.selectedSampleId = currentPacket()?.id || state.selectedSampleId;
  setImages(entries);
  state.progress = [`Loaded ${entries.length} custom application image${entries.length === 1 ? '' : 's'}.`];
  render();
}

async function blobForImageEntry(image) {
  if (image.file) return image.file;
  const response = await fetch(image.url);
  if (!response.ok) throw new Error(`Could not load ${image.name}.`);
  return response.blob();
}

async function runReview() {
  syncExpectedFromForm();
  if (!state.images.length || state.isProcessing) return;

  const startedAt = performance.now();
  activeReviewAbortController = new AbortController();
  state.isProcessing = true;
  state.error = '';
  state.progress = ['Starting auto review...'];
  state.review = null;
  state.batchStats = null;
  state.imageStatuses = createImageStatuses(state.images, 'queued', 'Queued');
  state.workerCount = getRecommendedBrowserOcrWorkerCount(state.images.length, { override: state.workerOverride });
  render();

  try {
    appendProgress(state.images.some((image) => image.ocrResult) ? 'Using cached OCR evidence.' : 'Using browser worker pool OCR.');
    const imageResults = new Array(state.images.length);
    const liveTasks = [];

    for (const [index, image] of state.images.entries()) {
      const fixture = await fixtureForImageEntry(image);
      if (fixture) {
        appendProgress(`Using local OCR fixture for ${image.name}.`);
        imageResults[index] = { ...image, ocrResult: fixture };
        setImageStatus(image.id, 'done', 'Done');
      } else {
        liveTasks.push({
          id: image.id,
          index,
          name: image.name,
          file: await blobForImageEntry(image),
        });
      }
    }

    if (liveTasks.length) {
      appendProgress(`Processing ${liveTasks.length} image${liveTasks.length === 1 ? '' : 's'} with ${state.workerCount} browser worker${state.workerCount === 1 ? '' : 's'}...`);
      const liveResults = await ocrWorkerPool.run(liveTasks, {
        workerCount: state.workerCount,
        signal: activeReviewAbortController.signal,
        onTaskStatus: (task, status, message) => setImageStatus(task.id, status, message),
        onTaskProgress: (task, message) => {
          setImageStatus(task.id, 'processing', message);
          appendProgress(`${task.name}: ${message}`);
        },
        onTaskComplete: (task) => setImageStatus(task.id, 'done', 'Done'),
      });

      for (const [taskIndex, result] of liveResults.entries()) {
        const task = liveTasks[taskIndex];
        imageResults[task.index] = { ...state.images[task.index], ocrResult: result };
      }
    }

    appendProgress('Comparing expected fields to evidence...');
    const review = validateLabelPacket(state.expected, imageResults);
    appendProgress('Preparing evidence crops...');
    state.review = initializeReviewerFields(await attachEvidenceCrops(review));
    const totalMs = Math.round(performance.now() - startedAt);
    state.batchStats = {
      imageCount: state.images.length,
      workerCount: state.workerCount,
      totalMs,
      imagesPerMinute: state.images.length ? Math.round((state.images.length / Math.max(totalMs, 1)) * 60000 * 10) / 10 : 0,
      mode: liveTasks.length ? 'browser-worker-pool' : 'fixture',
    };
    appendProgress('Done.');
  } catch (error) {
    if (error?.name === 'AbortError') {
      state.error = 'Review cancelled.';
    } else {
      state.error = error?.message || 'Could not read text from this image. Try a clearer, higher-resolution image.';
    }
  } finally {
    state.isProcessing = false;
    activeReviewAbortController = null;
    persistCurrentApplicationState({ syncForm: false });
    render();
  }
}

async function loadSampleAtIndex(index, { autoReview = true, saveCurrent = true } = {}) {
  if (state.isProcessing || !state.samplePackets.length) return;
  if (saveCurrent) persistCurrentApplicationState();

  const nextIndex = Math.max(0, Math.min(index, state.samplePackets.length - 1));
  const packet = state.samplePackets[nextIndex];
  state.currentMode = 'samples';
  state.currentSampleIndex = nextIndex;
  state.currentPacketId = packet.id;
  state.selectedSampleId = packet.id;
  closeViewer();

  const cached = state.applicationStates[packet.id];
  if (cached) {
    applyApplicationState(cached);
    render();
    if (autoReview && !state.review && state.images.length) await runReview();
    return;
  }

  state.progress = [`Loading ${packet.title}...`];
  state.error = '';
  state.review = null;
  render();

  try {
    const loaded = await loadSamplePacket(packet);
    state.expected = cloneExpectedFields(loaded.expected);
    state.images = loaded.images;
    state.imageStatuses = createImageStatuses(loaded.images);
    state.workerCount = 1;
    state.batchStats = null;
    state.progress = [`Loaded ${packet.title}.`];
    state.error = '';
    state.applicationStates = {
      ...state.applicationStates,
      [packet.id]: snapshotCurrentApplication(),
    };
    render();
    if (autoReview && state.images.length) await runReview();
  } catch (error) {
    state.error = error?.message || 'Could not load the selected sample application.';
    render();
  }
}

async function resetDemo() {
  if (state.isProcessing) return;
  revokeImageEntryUrls(state.images);
  state.applicationStates = {};
  state.currentMode = 'samples';
  state.currentSampleIndex = 0;
  state.currentPacketId = state.samplePackets[0]?.id || '';
  state.selectedSampleId = state.currentPacketId;
  state.expected = blankExpectedFields();
  state.images = [];
  state.imageStatuses = {};
  state.review = null;
  state.progress = [];
  state.error = '';
  state.batchStats = null;
  closeViewer();
  render();
  if (state.samplePackets.length) await loadSampleAtIndex(0, { autoReview: true, saveCurrent: false });
}

function clearFields() {
  syncExpectedFromForm();
  state.expected = blankExpectedFields();
  state.review = null;
  render();
}

function cancelReview() {
  activeReviewAbortController?.abort();
  ocrWorkerPool.cancel();
}

function updateFieldDecision(index, status) {
  if (!state.review?.fields[index]) return;
  state.review.fields[index] = {
    ...state.review.fields[index],
    agentStatus: status,
  };
  refreshReviewOverall();
  persistCurrentApplicationState({ syncForm: false });
  render();
}

function updateFieldNote(index, note) {
  if (!state.review?.fields[index]) return;
  state.review.fields[index] = {
    ...state.review.fields[index],
    agentNote: note,
  };
  refreshReviewOverall();
  persistCurrentApplicationState({ syncForm: false });
}

function openViewer(imageId) {
  const width = Math.min(820, Math.max(360, window.innerWidth - 48));
  const height = Math.min(660, Math.max(320, window.innerHeight - 110));
  state.viewer = {
    ...state.viewer,
    open: true,
    imageId,
    zoom: 1,
    panX: 0,
    panY: 0,
    width,
    height,
    left: Math.max(18, window.innerWidth - width - 22),
    top: 82,
  };
  render();
}

function updateViewerTransform() {
  const image = document.querySelector('#floating-viewer-image');
  if (!image) return;
  image.style.transform = `translate(${Math.round(state.viewer.panX)}px, ${Math.round(state.viewer.panY)}px) scale(${state.viewer.zoom})`;
}

function setViewerZoom(nextZoom) {
  state.viewer.zoom = Math.max(0.35, Math.min(4, nextZoom));
  updateViewerTransform();
}

function resetViewerView() {
  state.viewer.zoom = 1;
  state.viewer.panX = 0;
  state.viewer.panY = 0;
  updateViewerTransform();
}

function handleAction(action, element) {
  if (action === 'previous-sample') {
    loadSampleAtIndex(state.currentSampleIndex - 1);
    return;
  }

  if (action === 'next-sample') {
    loadSampleAtIndex(state.currentSampleIndex + 1);
    return;
  }

  if (action === 'return-samples') {
    loadSampleAtIndex(Math.max(0, state.currentSampleIndex));
    return;
  }

  if (action === 'reset-demo') {
    resetDemo();
    return;
  }

  if (action === 'clear-fields') {
    clearFields();
    return;
  }

  if (action === 'clear-images') {
    syncExpectedFromForm();
    setImages([]);
    render();
    return;
  }

  if (action === 'trigger-upload') {
    document.querySelector('#image-input')?.click();
    return;
  }

  if (action === 'remove-image') {
    removeImage(element.dataset.imageId);
    render();
    return;
  }

  if (action === 'open-viewer') {
    openViewer(element.dataset.imageId);
    return;
  }

  if (action === 'close-viewer') {
    closeViewer();
    render();
    return;
  }

  if (action === 'viewer-zoom-in') {
    setViewerZoom(state.viewer.zoom + 0.2);
    return;
  }

  if (action === 'viewer-zoom-out') {
    setViewerZoom(state.viewer.zoom - 0.2);
    return;
  }

  if (action === 'viewer-reset-view') {
    resetViewerView();
    return;
  }

  if (action === 'run-review') {
    runReview();
    return;
  }

  if (action === 'cancel-review') {
    cancelReview();
    return;
  }

  if (action === 'export-json' && state.review) {
    exportJsonReport(state.review);
    return;
  }

  if (action === 'export-csv' && state.review) {
    exportCsvSummary(state.review);
    return;
  }

  if (action === 'export-pdf' && state.review) {
    exportPdfReport(state.review);
  }
}

function bindViewerInteractions() {
  const panel = document.querySelector('#floating-viewer');
  const header = document.querySelector('#floating-viewer-header');
  const body = document.querySelector('#floating-viewer-body');
  if (!panel || !header || !body) return;

  if ('ResizeObserver' in window) {
    const resizeObserver = new ResizeObserver(([entry]) => {
      state.viewer.width = entry.contentRect.width;
      state.viewer.height = entry.contentRect.height;
    });
    resizeObserver.observe(panel);
  }

  header.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = state.viewer.left;
    const startTop = state.viewer.top;

    function move(moveEvent) {
      state.viewer.left = Math.max(0, startLeft + moveEvent.clientX - startX);
      state.viewer.top = Math.max(0, startTop + moveEvent.clientY - startY);
      panel.style.left = `${Math.round(state.viewer.left)}px`;
      panel.style.top = `${Math.round(state.viewer.top)}px`;
    }

    function stop() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  });

  body.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      setViewerZoom(state.viewer.zoom + (event.deltaY < 0 ? 0.16 : -0.16));
    },
    { passive: false },
  );

  body.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startPanX = state.viewer.panX;
    const startPanY = state.viewer.panY;
    body.setPointerCapture(event.pointerId);

    function move(moveEvent) {
      state.viewer.panX = startPanX + moveEvent.clientX - startX;
      state.viewer.panY = startPanY + moveEvent.clientY - startY;
      updateViewerTransform();
    }

    function stop() {
      body.removeEventListener('pointermove', move);
      body.removeEventListener('pointerup', stop);
      body.removeEventListener('pointercancel', stop);
    }

    body.addEventListener('pointermove', move);
    body.addEventListener('pointerup', stop, { once: true });
    body.addEventListener('pointercancel', stop, { once: true });
  });
}

function bindEvents() {
  document.querySelector('#image-input')?.addEventListener('change', (event) => {
    addUploadedFiles(event.target.files);
    event.target.value = '';
  });

  document.querySelector('#sample-select')?.addEventListener('change', (event) => {
    const index = state.samplePackets.findIndex((sample) => sample.id === event.target.value);
    if (index >= 0) loadSampleAtIndex(index);
  });

  document.querySelector('#worker-count-select')?.addEventListener('change', (event) => {
    state.workerOverride = event.target.value;
  });

  document.querySelectorAll('.decision-select').forEach((select) => {
    select.addEventListener('change', () => updateFieldDecision(Number(select.dataset.reviewFieldIndex), select.value));
  });

  document.querySelectorAll('.agent-note').forEach((textarea) => {
    textarea.addEventListener('input', () => updateFieldNote(Number(textarea.dataset.reviewFieldIndex), textarea.value));
  });

  const dropZone = document.querySelector('#drop-zone');
  dropZone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('is-dragging');
  });
  dropZone?.addEventListener('dragleave', () => {
    dropZone.classList.remove('is-dragging');
  });
  dropZone?.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragging');
    addUploadedFiles(event.dataTransfer.files);
  });

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => handleAction(button.dataset.action, button));
  });

  bindViewerInteractions();
}

function render() {
  app.innerHTML = renderApp(state);
  bindEvents();
}

render();

loadSampleManifest()
  .then(async (packets) => {
    state.samplePackets = packets;
    state.currentPacketId = packets[0]?.id || '';
    state.selectedSampleId = state.currentPacketId;
    render();
    if (packets.length) await loadSampleAtIndex(0, { autoReview: true, saveCurrent: false });
  })
  .catch((error) => {
    state.error = error?.message || 'Could not load sample application library.';
    render();
  });
