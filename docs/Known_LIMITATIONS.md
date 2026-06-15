# Known Limitations

This file is intentionally explicit so evaluators can tell prototype scope from finished product behavior.

## System Boundary

- This is not an official TTB or Treasury system.
- It does not make legal determinations.
- It is an assessment prototype for workflow, architecture, OCR evidence, deterministic validation, and review operations.
- No cloud AI is required.

## Browser Fallback

- Browser fallback OCR quality depends on image quality, browser performance, and local hardware.
- Uploaded browser-fallback images stay in that browser session and are not persisted across a full browser data reset.
- Bundled samples often use OCR fixtures so the evaluator path is fast and repeatable.
- The browser worker pool supports multi-image packets and CSV manifests, but the main console reviewer queue is optimized around one-image applications.

## Backend

- Backend mode is the primary evaluator path and persists core applications, assets, jobs, workers, reviews, settings, audit, retention, and benchmark data.
- Some browser-snapshot conveniences do not yet have complete persisted backend parity, especially every draft/correction/reviewer field-decision detail.
- WebSocket live updates are derived from polling/database snapshots, not database triggers.
- SQLite is the default no-Docker evaluator database; Postgres is supported by configuration but not required for the demo.
- Multi-host worker orchestration is intentionally out of scope for the hardened shippable demo.

## OCR And Validation

- OCR/model output is treated as evidence only.
- Deterministic validators decide field status from expected values and extracted evidence.
- The validator set covers the assessment fields: brand, class/type, alcohol content, net contents, government warning, producer/importer, country of origin, application ID, and label ID.
- Real TTB review would require a broader regulatory rule set and official policy interpretation.

## Security

- Demo auth is assessment-grade. It is not SSO, MFA, or production identity management.
- LAN mode is for trusted local networks only and requires explicit CORS origins.
- Retention actions are for demo cleanup, not production records management.
- Worker join tokens and secrets are local-demo controls, not enterprise device attestation.

## Documentation Artifacts

- Screenshots in `docs/screenshots` are captured from the local console and should be refreshed after major UI changes.
- Multi-host worker setup is intentionally out of scope for the shippable demo. Use the local backend worker path.

## Performance

- Quick benchmarks use fixtures and calibrated estimates so they run quickly on CPU-only machines.
- They are useful for relative plumbing checks, not authoritative live OCR throughput.
- Slow live OCR tests are opt-in.
