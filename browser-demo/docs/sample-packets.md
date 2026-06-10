# Sample Packet Format

Sample labels are defined under `public/label-packets/`.

The library starts at:

```text
public/label-packets/manifest.json
```

Each packet has:

```text
public/label-packets/<packet-id>/
  cola-sheet.png
  expected.json
  ocr-fixture.json
```

`expected.json` uses the same field shape as the manual expected-fields form. `ocr-fixture.json` gives deterministic OCR text for regression tests and for the sample queue, which keeps the demo fast and makes it behave like application records loaded from a database.

Uploaded images run through browser OCR. Sample queue entries should stay one image per application and should keep `useFixtureByDefault: true`.

To add a packet:

1. Create a folder under `public/label-packets/`.
2. Add one synthetic `cola-sheet.png` application image.
3. Add `expected.json`.
4. Add `ocr-fixture.json`.
5. Add the packet to `manifest.json`.
6. Run `npm test` and `npm run build`.

Use synthetic images for public samples unless there is a clear right to publish the source artwork.

The current manifest contains twelve one-image COLA sheet applications, including the six newly classified root images:

- Sunburst Social Peach Lime Fizz
- Lumin8 Blue Raspberry
- Arbor Hill Cabernet Sauvignon
- Northern Lights Vodka
- High Tide Pineapple Passionfruit
- Estrella Tequila Blanco
