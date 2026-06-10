import { blocksFromText, createOcrResult } from '../ocr/ocr-types.js';

function assetPath(path) {
  return `${import.meta.env.BASE_URL}${path}`.replace(/\/{2,}/g, '/').replace(':/', '://');
}

async function fetchJson(path) {
  const response = await fetch(assetPath(path));
  if (!response.ok) {
    throw new Error(`Could not load sample data from ${path}.`);
  }
  return response.json();
}

function fixtureToOcrResult(fixture, packetTitle, imageName) {
  if (!fixture) return null;
  return createOcrResult({
    engine: fixture.engine || 'local-fixture',
    rawText: fixture.rawText || '',
    blocks: fixture.blocks || blocksFromText(fixture.rawText || '', fixture.confidence ?? 0.98),
    processingTimeMs: fixture.processingTimeMs ?? 25,
    preprocessingNotes: fixture.preprocessingNotes || [`Sample OCR fixture loaded for ${packetTitle}: ${imageName}`],
    warnings: fixture.warnings || [],
    source: 'fixture',
  });
}

export async function loadSampleManifest() {
  const manifest = await fetchJson('label-packets/manifest.json');
  return manifest.packets || [];
}

export async function loadSamplePacket(packet) {
  const [expected, fixture] = await Promise.all([
    fetchJson(packet.expectedPath),
    packet.ocrFixturePath ? fetchJson(packet.ocrFixturePath) : Promise.resolve({ images: {} }),
  ]);

  return {
    expected,
    images: packet.images.map((image) => ({
      id: `${packet.id}:${image.id}`,
      packetId: packet.id,
      role: image.role || image.id,
      name: image.name,
      type: image.type || 'image/png',
      size: image.size || 0,
      url: assetPath(image.path),
      fixtureKey: image.fixtureKey || image.id,
      ocrResult: fixtureToOcrResult(fixture.images?.[image.fixtureKey || image.id], packet.title, image.name),
      source: 'sample',
    })),
  };
}

export async function fixtureForImageEntry(entry) {
  if (entry.ocrResult) return entry.ocrResult;
  return null;
}
