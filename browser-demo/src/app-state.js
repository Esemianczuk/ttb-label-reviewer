export const APP_VERSION = '1.0.0';

export const GOVERNMENT_WARNING_TEXT = `GOVERNMENT WARNING:
(1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects.
(2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.`;

export const FIELD_LABELS = {
  brandName: 'Brand Name',
  fancifulName: 'Fanciful Name',
  classType: 'Class/Type',
  alcoholContent: 'Alcohol Content',
  netContents: 'Net Contents',
  governmentWarning: 'Government Warning',
  producerName: 'Producer / Bottler / Importer',
  countryOfOrigin: 'Country of Origin',
  applicationId: 'Application ID',
  labelId: 'Filename / Label ID',
};

export const SAMPLE_EXPECTED_FIELDS = {
  brandName: 'HOLLOW RIDGE',
  classType: 'Kentucky Straight Bourbon Whiskey',
  alcoholContent: '45% ALC/VOL (90 PROOF)',
  netContents: '750 mL',
  governmentWarningRequired: true,
  producerName: 'Sunset Ridge Spirits, LLC',
  countryOfOrigin: 'United States',
  applicationId: 'SAMPLE-HOLLOW-RIDGE',
  labelId: 'Hollow Ridge synthetic COLA sheet',
};

export function createInitialState() {
  return {
    expected: { ...SAMPLE_EXPECTED_FIELDS },
    images: [],
    imageStatuses: {},
    samplePackets: [],
    selectedSampleId: '',
    currentMode: 'samples',
    currentPacketId: '',
    currentSampleIndex: 0,
    currentUploadBatchIndex: 0,
    uploadBatchRows: [],
    applicationStates: {},
    review: null,
    isProcessing: false,
    processingMode: 'backend',
    backendUrl: 'http://localhost:8000',
    backendStatus: 'checking',
    backendMessage: 'Checking backend...',
    backendHealth: null,
    backendSessionId: '',
    backendReviewId: '',
    backendWorkers: [],
    backendEvents: [],
    streamConnected: false,
    workerCount: 1,
    workerOverride: 'auto',
    batchStats: null,
    batchFilters: {
      fail: true,
      needsReview: true,
      warning: true,
      pass: true,
      missingWarning: true,
      abvMismatch: true,
      lowOcrConfidence: true,
    },
    batchSearch: '',
    selectedBatchRowId: '',
    progress: [],
    error: '',
    viewer: {
      open: false,
      imageId: '',
      zoom: 1,
      panX: 0,
      panY: 0,
      left: 420,
      top: 84,
      width: 760,
      height: 620,
    },
  };
}

export function cloneExpectedFields(fields) {
  return {
    brandName: fields.brandName || '',
    fancifulName: fields.fancifulName || '',
    classType: fields.classType || '',
    alcoholContent: fields.alcoholContent || '',
    netContents: fields.netContents || '',
    governmentWarningRequired: Boolean(fields.governmentWarningRequired),
    producerName: fields.producerName || '',
    countryOfOrigin: fields.countryOfOrigin || '',
    applicationId: fields.applicationId || '',
    labelId: fields.labelId || '',
  };
}
