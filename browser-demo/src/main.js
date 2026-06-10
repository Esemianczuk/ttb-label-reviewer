import './styles.css';
import { cloneExpectedFields, createInitialState } from './app-state.js';
import {
  checkBackendHealth,
  connectSessionStream,
  createRemoteApplication,
  fetchClusterSnapshot,
  getOrCreateSessionId,
  getStoredBackendUrl,
  remoteReviewToFrontendReview,
  startRemoteReview,
  storeBackendUrl,
  uploadRemoteImage,
  waitForRemoteReview,
} from './api/backend-client.js';
import { attachEvidenceCrops } from './evidence/evidence-crops.js';
import { filesToImageEntries, revokeImageEntryUrls } from './ui/drag-drop.js';
import { exportCsvSummary, exportJsonReport, exportPdfReport } from './ui/export.js';
import {
  createBatchRowsFromImages,
  createBatchRowsFromManifest,
  parseManifestFile,
  splitApplicationFiles,
  summarizeReviewForBatchRow,
} from './ui/batch-manifest.js';
import { fixtureForImageEntry, loadSampleManifest, loadSamplePacket } from './ui/sample-data.js';
import { renderApp } from './ui/render.js';
import { validateLabelPacket } from './validation/overall.js';
import { STATUS } from './validation/status.js';
import { BrowserOcrWorkerPool, getRecommendedBrowserOcrWorkerCount } from './workers/browser-worker-pool.js';

const app = document.querySelector('#app');
const state = createInitialState();
state.backendUrl = getStoredBackendUrl();
state.backendSessionId = getOrCreateSessionId();
const ocrWorkerPool = new BrowserOcrWorkerPool();
let activeReviewAbortController = null;
let backendStream = null;

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

function currentUploadBatchRow() {
  return state.uploadBatchRows[state.currentUploadBatchIndex] || null;
}

function currentApplicationMeta() {
  const packet = currentPacket();
  const uploadRow = currentUploadBatchRow();
  return {
    mode: state.currentMode,
    packetId: state.currentMode === 'samples' ? packet?.id || '' : '',
    uploadBatchId: state.currentMode === 'upload' ? uploadRow?.id || '' : '',
    title: state.currentMode === 'samples' ? packet?.title || 'Sample application' : uploadRow?.title || 'Uploaded application',
    queuePosition: state.currentMode === 'samples' ? state.currentSampleIndex + 1 : state.currentUploadBatchIndex + 1,
    queueTotal: state.currentMode === 'samples' ? state.samplePackets.length : state.uploadBatchRows.length || null,
  };
}

function currentApplicationStateKey() {
  if (state.currentMode === 'samples') return state.currentPacketId;
  return currentUploadBatchRow()?.id || '';
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
    processingMode: state.processingMode,
    backendReviewId: state.backendReviewId,
    workerCount: state.workerCount,
    workerOverride: state.workerOverride,
    batchStats: state.batchStats,
    progress: [...state.progress],
    error: state.error,
  };
}

function persistCurrentApplicationState({ syncForm = true } = {}) {
  const stateKey = currentApplicationStateKey();
  if (!stateKey) return;
  if (syncForm) syncExpectedFromForm();
  const snapshot = snapshotCurrentApplication();
  if (state.currentMode === 'samples') {
    state.applicationStates = {
      ...state.applicationStates,
      [state.currentPacketId]: snapshot,
    };
    return;
  }

  state.uploadBatchRows = state.uploadBatchRows.map((row) =>
    row.id === stateKey
      ? {
          ...row,
          expected: cloneExpectedFields(state.expected),
          images: state.images,
          applicationState: snapshot,
          ...(state.review ? summarizeReviewForBatchRow(state.review, state.batchStats?.mode || state.processingMode, state.batchStats?.totalMs) : {}),
        }
      : row,
  );
}

function applyApplicationState(applicationState, { revokeCurrent = true } = {}) {
  if (revokeCurrent) revokeImageEntryUrls(state.images);
  state.expected = cloneExpectedFields(applicationState.expected);
  state.images = applicationState.images || [];
  state.imageStatuses = { ...(applicationState.imageStatuses || createImageStatuses(state.images)) };
  state.review = applicationState.review || null;
  state.backendReviewId = applicationState.backendReviewId || '';
  state.workerCount = applicationState.workerCount || 1;
  state.workerOverride = applicationState.workerOverride || state.workerOverride || 'auto';
  state.batchStats = applicationState.batchStats || null;
  state.progress = [...(applicationState.progress || [])];
  state.error = applicationState.error || '';
}

function applyUploadBatchRow(row) {
  const cached = row.applicationState;
  if (cached) {
    applyApplicationState(cached, { revokeCurrent: false });
    return;
  }
  state.expected = cloneExpectedFields(row.expected);
  state.images = row.images || [];
  state.imageStatuses = createImageStatuses(state.images);
  state.review = row.review || null;
  state.backendReviewId = '';
  state.workerCount = 1;
  state.batchStats = row.durationMs
    ? {
        imageCount: row.images?.length || 0,
        workerCount: 1,
        totalMs: row.durationMs,
        imagesPerMinute: Math.round(((row.images?.length || 0) / Math.max(row.durationMs, 1)) * 60000 * 10) / 10,
        mode: row.processingMode || 'upload',
      }
    : null;
  state.progress = row.status === 'needs_image' ? ['This manifest row does not have a matched image yet.'] : state.progress;
  state.error = row.status === 'needs_image' ? 'Manifest row needs an image before review.' : '';
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

function backendCapableMode() {
  return state.processingMode === 'backend' || state.processingMode === 'cluster';
}

function effectiveProcessingMode() {
  if (!backendCapableMode()) return 'browser';
  return state.backendStatus === 'online' ? state.processingMode : 'browser';
}

async function refreshBackendStatus({ renderAfter = true } = {}) {
  state.backendStatus = 'checking';
  state.backendMessage = 'Checking backend...';
  if (renderAfter) render();
  try {
    state.backendHealth = await checkBackendHealth(state.backendUrl);
    state.backendStatus = 'online';
    state.backendMessage = `Backend online at ${state.backendUrl}`;
    await refreshClusterTelemetry({ renderAfter: false });
    startBackendStream();
  } catch (error) {
    state.backendHealth = null;
    state.backendStatus = 'offline';
    state.backendMessage = `Backend unavailable. Browser Only remains ready.`;
    state.clusterWorkers = [];
    state.clusterEvents = [];
    state.clusterStatus = null;
    stopBackendStream();
  }
  if (renderAfter) render();
}

async function refreshClusterTelemetry({ renderAfter = true } = {}) {
  if (state.backendStatus !== 'online') return;
  try {
    const snapshot = await fetchClusterSnapshot(state.backendUrl, { sessionId: state.backendSessionId });
    state.clusterWorkers = snapshot.workers || [];
    state.clusterEvents = snapshot.events || [];
    state.clusterStatus = snapshot.clusterStatus || null;
  } catch {
    state.clusterEvents = state.clusterEvents || [];
  }
  if (renderAfter) render();
}

function startBackendStream() {
  if (backendStream || state.backendStatus !== 'online') return;
  backendStream = connectSessionStream({
    backendUrl: state.backendUrl,
    sessionId: state.backendSessionId,
    onMessage: (message) => {
      if (message.type === 'connected') {
        state.streamConnected = true;
        render();
      }
      if (message.type === 'session_snapshot') {
        state.streamConnected = true;
        state.clusterWorkers = message.workers || state.clusterWorkers;
        state.clusterEvents = message.events || state.clusterEvents;
        render();
      }
    },
  });
  backendStream?.addEventListener?.('close', () => {
    state.streamConnected = false;
    backendStream = null;
  });
}

function stopBackendStream() {
  state.streamConnected = false;
  if (backendStream) {
    backendStream.close();
    backendStream = null;
  }
}

function setProcessingMode(mode) {
  state.processingMode = mode;
  state.error = '';
  if (backendCapableMode()) {
    refreshBackendStatus();
  } else {
    stopBackendStream();
    render();
  }
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

function reviewerDecisionStatus(field) {
  const candidate = field.agentStatus || field.status;
  return Object.values(STATUS).includes(candidate) ? candidate : field.status;
}

function initializeReviewerFields(review) {
  const fields = review.fields.map((field) => ({
    ...field,
    agentStatus: reviewerDecisionStatus(field),
    agentNote: field.agentNote || '',
    history: field.history || [
      {
        at: new Date().toISOString(),
        actor: 'Auto review',
        status: field.status,
        note: field.reason,
      },
    ],
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

async function addUploadedFiles(files) {
  persistCurrentApplicationState();
  syncExpectedFromForm();
  const { images: imageFiles, manifests } = splitApplicationFiles(files);
  const entries = filesToImageEntries(imageFiles);
  if (!entries.length && !manifests.length) {
    state.error = 'No supported files were selected. Use PNG, JPG/JPEG, WebP, or a CSV manifest.';
    render();
    return;
  }

  try {
    const manifestRows = manifests[0] ? await parseManifestFile(manifests[0]) : [];
    const batchRows = manifestRows.length
      ? createBatchRowsFromManifest(manifestRows, entries, state.expected)
      : createBatchRowsFromImages(entries, state.expected);
    if (!batchRows.length) {
      state.error = 'The CSV manifest did not contain any application rows.';
      render();
      return;
    }

    revokeImageEntryUrls(state.uploadBatchRows.flatMap((row) => row.images || []));
    state.currentMode = 'upload';
    state.currentPacketId = '';
    state.selectedSampleId = currentPacket()?.id || state.selectedSampleId;
    state.uploadBatchRows = batchRows;
    state.currentUploadBatchIndex = 0;
    state.selectedBatchRowId = batchRows[0].id;
    state.progress = [
      manifestRows.length
        ? `Loaded ${batchRows.length} application${batchRows.length === 1 ? '' : 's'} from ${manifests[0].name}.`
        : `Loaded ${batchRows.length} uploaded application${batchRows.length === 1 ? '' : 's'}.`,
    ];
    applyUploadBatchRow(batchRows[0]);
    render();
  } catch (error) {
    revokeImageEntryUrls(entries);
    state.error = error?.message || 'Could not load the uploaded application batch.';
    render();
  }
}

async function blobForImageEntry(image) {
  if (image.file) return image.file;
  const response = await fetch(image.url);
  if (!response.ok) throw new Error(`Could not load ${image.name}.`);
  return response.blob();
}

async function runBrowserReview(startedAt, modeLabel = 'browser') {
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
    appendProgress(
      `Processing ${liveTasks.length} image${liveTasks.length === 1 ? '' : 's'} with ${state.workerCount} browser worker${state.workerCount === 1 ? '' : 's'}...`,
    );
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
    mode: liveTasks.length ? `${modeLabel}-worker-pool` : `${modeLabel}-fixture`,
  };
  appendProgress('Done.');
}

async function runRemoteReview(startedAt, processingMode) {
  const applicationMeta = currentApplicationMeta();
  appendProgress(`Uploading application packet to ${state.backendUrl}...`);
  const remoteApplication = await createRemoteApplication({
    backendUrl: state.backendUrl,
    sessionId: state.backendSessionId,
    expected: state.expected,
    application: applicationMeta,
  });

  for (const image of state.images) {
    setImageStatus(image.id, 'processing', 'Uploading');
    await uploadRemoteImage({
      backendUrl: state.backendUrl,
      sessionId: state.backendSessionId,
      applicationId: remoteApplication.id,
      image,
      blob: await blobForImageEntry(image),
    });
    setImageStatus(image.id, 'queued', 'Queued on backend');
  }

  const queuedReview = await startRemoteReview({
    backendUrl: state.backendUrl,
    sessionId: state.backendSessionId,
    applicationId: remoteApplication.id,
    mode: processingMode,
  });
  state.backendReviewId = queuedReview.id;
  appendProgress(`${processingMode === 'cluster' ? 'Cluster' : 'Local backend'} review queued. Waiting for worker results...`);
  await refreshClusterTelemetry({ renderAfter: true });

  const remoteReview = await waitForRemoteReview({
    backendUrl: state.backendUrl,
    sessionId: state.backendSessionId,
    reviewId: queuedReview.id,
    signal: activeReviewAbortController.signal,
    onPoll: (review) => {
      appendProgress(`Backend status: ${review.status}.`);
      refreshClusterTelemetry({ renderAfter: false });
    },
  });

  state.images.forEach((image) => setImageStatus(image.id, 'done', 'Done'));
  const frontendReview = remoteReviewToFrontendReview(remoteReview, {
    expected: cloneExpectedFields(state.expected),
    images: state.images,
    application: applicationMeta,
    processingMode,
    startedAt,
  });
  state.review = initializeReviewerFields(await attachEvidenceCrops(frontendReview));
  const totalMs = Math.round(performance.now() - startedAt);
  const workerCount = Math.max(1, state.clusterWorkers.filter((worker) => worker.status === 'online').length);
  state.batchStats = {
    imageCount: state.images.length,
    workerCount,
    totalMs,
    imagesPerMinute: state.images.length ? Math.round((state.images.length / Math.max(totalMs, 1)) * 60000 * 10) / 10 : 0,
    mode: processingMode,
  };
  appendProgress('Done.');
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
  state.backendReviewId = '';
  state.imageStatuses = createImageStatuses(state.images, 'queued', 'Queued');
  state.workerCount = getRecommendedBrowserOcrWorkerCount(state.images.length, { override: state.workerOverride });
  render();

  let runMode = 'browser';
  try {
    if (backendCapableMode()) {
      await refreshBackendStatus({ renderAfter: false });
      runMode = effectiveProcessingMode();
      if (runMode === 'browser') appendProgress('Backend is unavailable. Falling back to Browser Only.');
    }

    if (runMode === 'browser') {
      await runBrowserReview(startedAt);
    } else {
      await runRemoteReview(startedAt, runMode);
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      state.error = 'Review cancelled.';
    } else {
      state.error = error?.message || 'Could not process this application. Try Browser Only or check backend workers.';
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
  const previousMode = state.currentMode;
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
    applyApplicationState(cached, { revokeCurrent: previousMode !== 'upload' });
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

async function loadUploadBatchAtIndex(index, { autoReview = false, saveCurrent = true } = {}) {
  if (state.isProcessing || !state.uploadBatchRows.length) return;
  if (saveCurrent) persistCurrentApplicationState();
  const nextIndex = Math.max(0, Math.min(index, state.uploadBatchRows.length - 1));
  const row = state.uploadBatchRows[nextIndex];
  state.currentMode = 'upload';
  state.currentPacketId = '';
  state.currentUploadBatchIndex = nextIndex;
  state.selectedBatchRowId = row.id;
  closeViewer();
  applyUploadBatchRow(row);
  render();
  if (autoReview && !state.review && state.images.length) await runReview();
}

function hasPreviousApplication() {
  if (state.currentMode === 'upload') return state.currentUploadBatchIndex > 0;
  return state.currentSampleIndex > 0;
}

function hasNextApplication() {
  if (state.currentMode === 'upload') return state.currentUploadBatchIndex < state.uploadBatchRows.length - 1;
  return state.currentSampleIndex < state.samplePackets.length - 1;
}

function previousApplication() {
  if (state.currentMode === 'upload') {
    loadUploadBatchAtIndex(state.currentUploadBatchIndex - 1);
  } else {
    loadSampleAtIndex(state.currentSampleIndex - 1);
  }
}

function nextApplication() {
  if (state.currentMode === 'upload') {
    loadUploadBatchAtIndex(state.currentUploadBatchIndex + 1);
  } else {
    loadSampleAtIndex(state.currentSampleIndex + 1);
  }
}

async function resetDemo() {
  if (state.isProcessing) return;
  revokeImageEntryUrls(state.images);
  revokeImageEntryUrls(state.uploadBatchRows.flatMap((row) => row.images || []));
  state.applicationStates = {};
  state.uploadBatchRows = [];
  state.currentUploadBatchIndex = 0;
  state.currentMode = 'samples';
  state.currentSampleIndex = 0;
  state.currentPacketId = state.samplePackets[0]?.id || '';
  state.selectedSampleId = state.currentPacketId;
  state.selectedBatchRowId = '';
  state.expected = blankExpectedFields();
  state.images = [];
  state.imageStatuses = {};
  state.review = null;
  state.progress = [];
  state.error = '';
  state.batchStats = null;
  state.backendReviewId = '';
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
    history: [
      ...(state.review.fields[index].history || []),
      {
        at: new Date().toISOString(),
        actor: 'Agent',
        status,
        note: 'Reviewer decision updated.',
      },
    ],
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

function updateAllFieldDecisions(status) {
  if (!state.review?.fields?.length) return;
  state.review = {
    ...state.review,
    fields: state.review.fields.map((field) => ({
      ...field,
      agentStatus: status,
      history: [
        ...(field.history || []),
        {
          at: new Date().toISOString(),
          actor: 'Agent',
          status,
          note: 'Bulk reviewer decision updated.',
        },
      ],
    })),
  };
  refreshReviewOverall();
  persistCurrentApplicationState({ syncForm: false });
  render();
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
    previousApplication();
    return;
  }

  if (action === 'next-sample') {
    nextApplication();
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

  if (action === 'refresh-backend') {
    syncExpectedFromForm();
    refreshBackendStatus();
    return;
  }

  if (action === 'select-batch-row') {
    const rowIndex = state.uploadBatchRows.findIndex((row) => row.id === element.dataset.batchRowId);
    if (rowIndex >= 0) loadUploadBatchAtIndex(rowIndex);
    return;
  }

  if (action === 'select-sample-row') {
    const sampleIndex = Number(element.dataset.sampleIndex);
    if (Number.isFinite(sampleIndex)) loadSampleAtIndex(sampleIndex, { autoReview: false });
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

function handleKeyboardShortcut(event) {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  const isTextEntry = target?.matches?.('input, textarea, select, [contenteditable="true"]');
  if (isTextEntry && event.key !== '/') return;

  const key = event.key.toLowerCase();
  if (key === 'n') {
    event.preventDefault();
    if (hasNextApplication()) nextApplication();
  } else if (key === 'p') {
    event.preventDefault();
    if (hasPreviousApplication()) previousApplication();
  } else if (key === 'a') {
    event.preventDefault();
    updateAllFieldDecisions(STATUS.PASS);
  } else if (key === 'r') {
    event.preventDefault();
    updateAllFieldDecisions(STATUS.NEEDS_REVIEW);
  } else if (key === 'f') {
    event.preventDefault();
    updateAllFieldDecisions(STATUS.FAIL);
  } else if (key === 'e') {
    event.preventDefault();
    if (state.images[0]) openViewer(state.images[0].id);
  } else if (event.key === '/') {
    event.preventDefault();
    document.querySelector('#batch-search')?.focus();
  }
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

  document.querySelector('#processing-mode-select')?.addEventListener('change', (event) => {
    setProcessingMode(event.target.value);
  });

  document.querySelector('#backend-url-input')?.addEventListener('change', (event) => {
    state.backendUrl = event.target.value.trim() || state.backendUrl;
    storeBackendUrl(state.backendUrl);
    if (backendCapableMode()) refreshBackendStatus();
    else render();
  });

  document.querySelectorAll('.batch-filter').forEach((input) => {
    input.addEventListener('change', () => {
      state.batchFilters = {
        ...state.batchFilters,
        [input.name]: input.checked,
      };
      render();
    });
  });

  document.querySelector('#batch-search')?.addEventListener('input', (event) => {
    state.batchSearch = event.target.value;
    const cursor = event.target.selectionStart || state.batchSearch.length;
    render();
    const nextInput = document.querySelector('#batch-search');
    nextInput?.focus();
    nextInput?.setSelectionRange?.(cursor, cursor);
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
document.addEventListener('keydown', handleKeyboardShortcut);
refreshBackendStatus({ renderAfter: true });

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
