import './styles.css';
import { cloneExpectedFields, createInitialState, OLD_TOM_SAMPLE_EXPECTED } from './app-state.js';
import { recognizeImage } from './ocr/tesseract-engine.js';
import { filesToImageEntries, revokeImageEntryUrls } from './ui/drag-drop.js';
import { exportCsvSummary, exportJsonReport } from './ui/export.js';
import { createSampleImageEntries, fixtureForImageEntry, sampleExpectedFields } from './ui/sample-data.js';
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
  state.review = null;
  state.error = '';
}

function appendProgress(line) {
  state.progress = [...state.progress.slice(-5), line];
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
  setImages(entries);
  render();
}

async function runReview() {
  syncExpectedFromForm();
  if (!state.images.length || state.isProcessing) return;

  state.isProcessing = true;
  state.error = '';
  state.progress = ['Starting local review...'];
  state.review = null;
  render();

  try {
    const imageResults = [];
    for (const image of state.images) {
      appendProgress(`Checking ${image.name}...`);
      const fixture = await fixtureForImageEntry(image);
      if (fixture) {
        appendProgress(`Using local OCR fixture for ${image.name}.`);
        imageResults.push({ ...image, ocrResult: fixture });
        continue;
      }

      const ocrResult = await recognizeImage(image.file, {
        onProgress: (line) => appendProgress(`${image.name}: ${line}`),
      });
      imageResults.push({ ...image, ocrResult });
    }

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

function handleAction(action) {
  if (action === 'load-sample') {
    state.expected = sampleExpectedFields();
    setImages(createSampleImageEntries());
    render();
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
    button.addEventListener('click', () => handleAction(button.dataset.action));
  });
}

function render() {
  app.innerHTML = renderApp(state);
  bindEvents();
}

render();
