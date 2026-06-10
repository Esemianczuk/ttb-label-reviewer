import './styles.css';
import { cloneExpectedFields, createInitialState, OLD_TOM_SAMPLE_EXPECTED } from './app-state.js';
import { getRecommendedEasyOcrWorkerCount, recognizeImageWithEasyOcr } from './ocr/easyocr-service-client.js';
import { createCustomLabelImageEntries } from './ui/custom-label.js';
import { filesToImageEntries, revokeImageEntryUrls } from './ui/drag-drop.js';
import { exportCsvSummary, exportJsonReport } from './ui/export.js';
import { fixtureForImageEntry, loadSampleManifest, loadSamplePacket } from './ui/sample-data.js';
import { renderApp } from './ui/render.js';
import { validateLabelPacket } from './validation/overall.js';

const app = document.querySelector('#app');
const state = createInitialState();

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

function setImages(entries) {
  revokeImageEntryUrls(state.images);
  state.images = entries;
  state.imageStatuses = Object.fromEntries(entries.map((entry) => [entry.id, { status: 'ready', message: 'Ready' }]));
  state.review = null;
  state.error = '';
}

function appendImages(entries) {
  state.images = [...state.images, ...entries];
  state.imageStatuses = {
    ...state.imageStatuses,
    ...Object.fromEntries(entries.map((entry) => [entry.id, { status: 'ready', message: 'Ready' }])),
  };
  state.review = null;
  state.error = '';
}

function removeImage(imageId) {
  const image = state.images.find((entry) => entry.id === imageId);
  if (image) revokeImageEntryUrls([image]);
  state.images = state.images.filter((entry) => entry.id !== imageId);
  const nextStatuses = { ...state.imageStatuses };
  delete nextStatuses[imageId];
  state.imageStatuses = nextStatuses;
  state.review = null;
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

function addUploadedFiles(files) {
  syncExpectedFromForm();
  const entries = filesToImageEntries(files);
  if (!entries.length) {
    state.error = 'No supported image files were selected. Use PNG, JPG/JPEG, or WebP.';
    render();
    return;
  }
  appendImages(entries);
  render();
}

async function blobForImageEntry(image) {
  if (image.file) return image.file;
  const response = await fetch(image.url);
  if (!response.ok) throw new Error(`Could not load ${image.name}.`);
  return response.blob();
}

async function processImage(image, workerSlot) {
  setImageStatus(image.id, 'processing', 'Processing');
  appendProgress(`Checking ${image.name}...`);

  const fixture = await fixtureForImageEntry(image);
  if (fixture) {
    appendProgress(`Using local OCR fixture for ${image.name}.`);
    setImageStatus(image.id, 'done', 'Done');
    return { ...image, ocrResult: fixture };
  }

  const imageBlob = await blobForImageEntry(image);
  const ocrResult = await recognizeImageWithEasyOcr(imageBlob, {
    workerSlot,
    onProgress: (line) => {
      setImageStatus(image.id, 'processing', line);
      appendProgress(`${image.name}: ${line}`);
    },
  });

  setImageStatus(image.id, 'done', 'Done');
  return { ...image, ocrResult };
}

async function runReview() {
  syncExpectedFromForm();
  if (!state.images.length || state.isProcessing) return;

  state.isProcessing = true;
  state.error = '';
  state.progress = ['Starting local review...'];
  state.review = null;
  state.imageStatuses = Object.fromEntries(state.images.map((entry) => [entry.id, { status: 'queued', message: 'Queued' }]));
  state.workerCount = getRecommendedEasyOcrWorkerCount(state.images.length);
  render();

  try {
    appendProgress('Using EasyOCR local service.');
    const imageResults = new Array(state.images.length);
    let nextIndex = 0;
    const workerLoops = Array.from({ length: state.workerCount }, async (_, workerSlot) => {
      while (nextIndex < state.images.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          imageResults[index] = await processImage(state.images[index], workerSlot);
        } catch (error) {
          setImageStatus(state.images[index].id, 'error', 'Could not read image');
          throw error;
        }
      }
    });
    await Promise.all(workerLoops);

    appendProgress('Comparing fields...');
    state.review = validateLabelPacket(state.expected, imageResults);
    appendProgress('Done.');
  } catch (error) {
    state.error = error?.message || 'Could not read text from this image. Try a clearer, higher-resolution image.';
  } finally {
    state.isProcessing = false;
    render();
  }
}

async function loadSelectedSamplePacket() {
  const packet = state.samplePackets.find((sample) => sample.id === state.selectedSampleId) || state.samplePackets[0];
  if (!packet) return;
  try {
    syncExpectedFromForm();
    appendProgress(`Loading sample packet: ${packet.title}`);
    const loaded = await loadSamplePacket(packet);
    state.expected = cloneExpectedFields(loaded.expected);
    setImages(loaded.images);
    state.review = null;
    render();
  } catch (error) {
    state.error = error?.message || 'Could not load the selected sample packet.';
    render();
  }
}

async function createCustomPacket() {
  syncExpectedFromForm();
  const entries = await createCustomLabelImageEntries(state.expected);
  appendImages(entries);
  appendProgress('Created custom synthetic front/back images from expected fields.');
  render();
}

function handleAction(action, element) {
  if (action === 'load-sample') {
    loadSelectedSamplePacket();
    return;
  }
  if (action === 'reset-old-tom') {
    syncExpectedFromForm();
    state.expected = { ...OLD_TOM_SAMPLE_EXPECTED };
    state.review = null;
    render();
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

  if (action === 'create-custom') {
    createCustomPacket();
    return;
  }

  if (action === 'run-review') {
    runReview();
    return;
  }

  if (action === 'export-json' && state.review) {
    exportJsonReport(state.review);
    return;
  }

  if (action === 'export-csv' && state.review) {
    exportCsvSummary(state.review);
  }
}

function bindEvents() {
  document.querySelector('#image-input')?.addEventListener('change', (event) => {
    addUploadedFiles(event.target.files);
    event.target.value = '';
  });

  document.querySelector('#sample-select')?.addEventListener('change', (event) => {
    state.selectedSampleId = event.target.value;
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
}

function render() {
  app.innerHTML = renderApp(state);
  bindEvents();
}

render();

loadSampleManifest()
  .then((packets) => {
    state.samplePackets = packets;
    state.selectedSampleId = packets[0]?.id || '';
    render();
  })
  .catch((error) => {
    state.error = error?.message || 'Could not load sample packet library.';
    render();
  });
