# Sample Packet Format

Sample labels are defined under `public/label-packets/`.

The library starts at:

```text
public/label-packets/manifest.json
```

Each packet has:

```text
public/label-packets/<packet-id>/
  front.png
  back.png
  expected.json
  ocr-fixture.json
```

`expected.json` uses the same field shape as the manual expected-fields form. `ocr-fixture.json` gives deterministic OCR text for demos and regression tests, while uploaded or generated images run through the localhost EasyOCR service.

To add a packet:

1. Create a folder under `public/label-packets/`.
2. Add one or more synthetic label images.
3. Add `expected.json`.
4. Add `ocr-fixture.json`.
5. Add the packet to `manifest.json`.
6. Run `npm test` and `npm run build`.

Use synthetic images for public samples unless there is a clear right to publish the source artwork.
