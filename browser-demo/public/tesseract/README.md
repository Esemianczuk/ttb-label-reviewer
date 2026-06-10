# Local Tesseract.js Assets

The browser OCR module first checks this folder for packaged Tesseract.js assets:

```text
public/tesseract/
  worker.min.js
  core/
    tesseract-core.wasm.js
    tesseract-core-simd.wasm.js
    tesseract-core-lstm.wasm.js
    tesseract-core-simd-lstm.wasm.js
    *.wasm
  lang/
    eng.traineddata.gz
```

If `worker.min.js` is absent, the development build falls back to public Tesseract.js CDNs for engine assets. Uploaded image bytes remain in the browser session.

Do not commit large downloaded language/model bundles unless the project explicitly decides to vendor them for the final submission.
