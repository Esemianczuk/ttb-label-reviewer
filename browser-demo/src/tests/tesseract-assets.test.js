import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetTesseractAssetConfigForTests, resolveTesseractAssetConfigForTests } from '../ocr/browser-tesseract.js';

describe('Tesseract asset resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetTesseractAssetConfigForTests();
  });

  it('uses packaged local assets when the worker file is present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    resetTesseractAssetConfigForTests();

    const config = await resolveTesseractAssetConfigForTests();

    expect(config.usesCdnFallback).toBe(false);
    expect(config.workerPath).toBe('/tesseract/worker.min.js');
    expect(config.corePath).toBe('/tesseract/core');
    expect(config.langPath).toBe('/tesseract/lang');
  });

  it('rejects CDN fallback by default when local assets are missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    resetTesseractAssetConfigForTests();

    await expect(resolveTesseractAssetConfigForTests()).rejects.toThrow('VITE_ALLOW_TESSERACT_CDN_FALLBACK=1');
  });

  it('allows CDN fallback only when explicitly enabled for development', async () => {
    vi.stubEnv('VITE_ALLOW_TESSERACT_CDN_FALLBACK', '1');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    resetTesseractAssetConfigForTests();

    const config = await resolveTesseractAssetConfigForTests();

    expect(config.usesCdnFallback).toBe(true);
    expect(config.workerPath).toContain('cdn.jsdelivr.net');
  });
});
