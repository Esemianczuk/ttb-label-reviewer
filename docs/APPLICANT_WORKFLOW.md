# Applicant Workflow

The applicant portal demonstrates how a submitter can prepare a local label application packet, attach label images, submit it for reviewer action, and resubmit updates when a reviewer requests changes.

Backend mode is the primary evaluator path. Browser fallback remains available when the coordinator is absent and keeps uploads local to the browser session.

## What To Click

1. Open the console.
2. Click `Continue as Applicant`, or switch `Signed in as` to `Applicant`.
3. Open `Applicant Portal`.
4. Click `New Application`.
5. Step through `Product`, `Fields`, `Images`, and `Submit`.
6. Upload one label image for the typical application path. Up to 10 images are accepted for multi-image packet testing.
7. Assign image roles when testing multi-image packets.
8. If the readiness result is acceptable, click `Submit for Review`.
9. Download a packet PDF from the table or detail view.

Expected outcome:

- Required application fields and at least one image are enforced.
- Browser fallback keeps uploaded images in the browser session.
- OCR and deterministic validation are reviewer tools; applicant uploads remain local in browser fallback mode.
- The application moves through draft, submitted, correction, resubmission, and decision states.

## Fields

The wizard captures the TTB-facing fields used by the validators:

- Product type.
- Brand name.
- Fanciful name.
- Class/type.
- Alcohol content.
- Net contents.
- Producer/importer.
- Country of origin.
- TTB application ID.
- Label ID.
- Government warning required.

## Images

The UI accepts JPG/JPEG, PNG, and WebP for local testing. Each uploaded file is converted into a local browser object URL in browser fallback mode.

Supported role labels:

- front
- back
- neck
- carton
- other
- COLA sheet

The take-home demo is optimized around one image per application, because that is the common reviewer path here. Multi-image packets and CSV manifests remain available for stress and parity tests.

## Corrections

When a reviewer requests a correction:

1. Switch to `Applicant`.
2. Open the packet from `Needs Attention` or click `Update Packet` on the dashboard.
3. Read the reviewer note shown above the application form.
4. Update the highlighted fields or replace the label image if needed.
5. Add an optional note for the reviewer.
6. Click `Resubmit Updates`, or choose `Create New Version` / `Withdraw`.
7. Confirm the packet status becomes resubmitted.

## Timeline And Export

The applicant detail and timeline routes show status history and audit-visible activity. PDF export includes the submitted fields, image reference, automated matches, reviewer notes where present, and processing trace.

## Verification

```bash
npm --prefix apps/console test -- --run
RUN_E2E=1 ./scripts/check-all.sh
```

The Playwright matrix includes applicant create/upload/submit and correction edit/resubmission flows.
