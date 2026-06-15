import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createOcrVariantPlanForTests,
  mapTesseractBboxForTests,
  resetTesseractAssetConfigForTests,
  resolveTesseractAssetConfigForTests,
} from '../ocr/browser-tesseract.js';

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
    expect(config.workerPath).toMatch(/\/tesseract\/worker\.min\.js$/);
    expect(config.corePath).toMatch(/\/tesseract\/core$/);
    expect(config.langPath).toMatch(/\/tesseract\/lang$/);
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

describe('Tesseract OCR planning', () => {
  it('uses full-image coverage plus broad overlapping high-contrast bands', () => {
    const variants = createOcrVariantPlanForTests(410, 539);

    expect(variants.some((variant) => variant.id === 'original-full-auto')).toBe(true);
    expect(variants.some((variant) => variant.id === 'original-full-sparse')).toBe(true);
    expect(variants.some((variant) => variant.id === 'normalized-gray-top-band')).toBe(true);
    expect(variants.some((variant) => variant.id === 'normalized-gray-bottom-band')).toBe(true);
    expect(variants.some((variant) => variant.id === 'threshold-inverted-top-band')).toBe(true);
    expect(variants.some((variant) => variant.id === 'left-edge-rot90-upright-block')).toBe(true);
    expect(variants.some((variant) => variant.id === 'right-edge-rot270-upright-sparse')).toBe(true);
    expect(variants.some((variant) => variant.id.includes('application-top'))).toBe(false);
    expect(variants.some((variant) => variant.id.includes('warning-right'))).toBe(false);

    for (const variant of variants) {
      expect(variant.rectangle.left).toBeGreaterThanOrEqual(0);
      expect(variant.rectangle.top).toBeGreaterThanOrEqual(0);
      expect(variant.rectangle.left + variant.rectangle.width).toBeLessThanOrEqual(variant.source.width);
      expect(variant.rectangle.top + variant.rectangle.height).toBeLessThanOrEqual(variant.source.height);
    }
  });

  it('maps preprocessed and relative Tesseract boxes back to original image pixels', () => {
    const scaledAbsolute = mapTesseractBboxForTests(
      { x0: 250, y0: 500, x1: 450, y1: 560 },
      { source: { scale: 2.5 }, rectangle: { left: 0, top: 0, width: 1025, height: 1348 } },
    );
    expect(scaledAbsolute).toEqual({ x: 100, y: 200, width: 80, height: 24 });

    const relativeToRectangle = mapTesseractBboxForTests(
      { x0: 20, y0: 30, x1: 120, y1: 60 },
      { source: { scale: 2 }, rectangle: { left: 200, top: 300, width: 400, height: 500 } },
    );
    expect(relativeToRectangle).toEqual({ x: 110, y: 165, width: 50, height: 15 });
  });

  it('maps rotated edge-band OCR boxes back onto the source label', () => {
    const rightEdgeClockwise = mapTesseractBboxForTests(
      { x0: 30, y0: 40, x1: 130, y1: 70 },
      {
        source: {
          scale: 2,
          crop: { x: 800, y: 10, width: 120, height: 500 },
          rotation: 90,
        },
        rectangle: { left: 0, top: 0, width: 1000, height: 240 },
      },
    );
    expect(rightEdgeClockwise).toEqual({ x: 820, y: 445, width: 15, height: 50 });

    const leftEdgeCounterClockwise = mapTesseractBboxForTests(
      { x0: 30, y0: 40, x1: 130, y1: 70 },
      {
        source: {
          scale: 2,
          crop: { x: 0, y: 10, width: 120, height: 500 },
          rotation: 270,
        },
        rectangle: { left: 0, top: 0, width: 1000, height: 240 },
      },
    );
    expect(leftEdgeCounterClockwise).toEqual({ x: 85, y: 25, width: 15, height: 50 });
  });
});
