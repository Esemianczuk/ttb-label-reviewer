# Local Tesseract.js Assets

These files are packaged by `npm run browser:package-tesseract` from `browser-demo/node_modules` and `browser-demo/eng.traineddata`.
Production browser and console builds load OCR worker, WASM core, and English traineddata from this directory with no runtime CDN dependency.

The CDN fallback is disabled by default and is available only for local development when `VITE_ALLOW_TESSERACT_CDN_FALLBACK=1` is set.
