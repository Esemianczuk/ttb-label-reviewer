const VALID_PRODUCT_TYPES = new Set(['distilled_spirits', 'wine', 'malt_beverage', 'unknown']);
const VALID_IMAGE_ROLES = new Set(['front', 'back', 'neck', 'carton', 'other', 'cola_sheet', 'unknown']);

export function normalizeImageRole(role = '') {
  const normalized = String(role || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (normalized === 'cola' || normalized === 'sheet') return 'cola_sheet';
  return VALID_IMAGE_ROLES.has(normalized) ? normalized : 'unknown';
}

export function normalizeProductType(productType = '') {
  const normalized = String(productType || '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
  return VALID_PRODUCT_TYPES.has(normalized) ? normalized : 'unknown';
}

export function expectedFieldsFromLegacyExpected(expected = {}) {
  return {
    productType: normalizeProductType(expected.productType),
    brandName: expected.brandName || '',
    fancifulName: expected.fancifulName || '',
    classType: expected.classType || '',
    alcoholContent: expected.alcoholContent || '',
    netContents: expected.netContents || '',
    governmentWarningRequired: Boolean(expected.governmentWarningRequired),
    producerName: expected.producerName || '',
    countryOfOrigin: expected.countryOfOrigin || '',
    applicationId: expected.applicationId || '',
    labelId: expected.labelId || '',
  };
}

export function applicationImagesFromEntries(images = []) {
  return images.map((image) => {
    const packetImage = {
      id: image.id,
      role: normalizeImageRole(image.role),
      name: image.name,
      mimeType: image.type || image.mimeType || 'image/png',
    };
    if (Number.isFinite(image.size || image.sizeBytes)) packetImage.sizeBytes = image.size || image.sizeBytes;
    if (image.url || image.localUrl) packetImage.localUrl = image.url || image.localUrl;
    if (image.assetId) packetImage.assetId = image.assetId;
    if (image.sha256) packetImage.sha256 = image.sha256;
    return packetImage;
  });
}

export function createApplicationPacketFromSample(packet, expected, images, { createdAt = new Date().toISOString() } = {}) {
  const expectedFields = expectedFieldsFromLegacyExpected(expected);
  const metadata = {
    createdAt,
  };
  if (packet.sourceUrl) metadata.sourceUrl = packet.sourceUrl;
  if (packet.ttbId || expectedFields.applicationId) metadata.ttbId = packet.ttbId || expectedFields.applicationId;
  if (packet.description) metadata.notes = packet.description;

  return {
    id: packet.id,
    applicationId: expectedFields.applicationId || packet.id,
    source: 'sample',
    status: 'SUBMITTED',
    expectedFields,
    images: applicationImagesFromEntries(images),
    metadata,
  };
}
