# Reviewer Workbench

The reviewer workbench is the primary evaluator surface. It loads real public COLA registry records as if a queue-backed agent had prepared them, runs automated review only when requested, and lets the reviewer move through one application at a time.

## Fast Review Path

```bash
npm install
npm run console:dev
```

What to click:

1. Open `http://127.0.0.1:5174/`.
2. Click `Continue as Reviewer`.
3. Open `TRANSCONTINENTAL OTHER FOREIGN RUM record`.
4. Click `Run automated review`.
5. Click `Next Application`.
6. Confirm the next reviewable packet opens.
7. Inspect expected values, extracted evidence, image crops, and any full-image review prompts for missing evidence.
8. Change reviewer status with the `Pass` and `Fail` control.
9. Add reasoning in the field text area or `Agent Notes`.
10. Click `Previous`; the TRANSCONTINENTAL reasoning remains preserved.
11. Click `PDF` to download the review packet.

## Workbench Areas

| Area | Purpose |
| --- | --- |
| Header | Status, processing mode, previous/next, auto review, PDF export. |
| Label Images | Thumbnail strip shown when a real public record has multiple label images. One-image records show the selected image directly. |
| Expanded viewer | Detached floating modal with drag-to-move, zoom buttons, and image panning. |
| Evidence column | Field-level source image thumbnail, OCR/evidence snippet, and confidence. |
| Extracted field text | Extracted text by field after processing, with raw OCR available in a collapsible panel when present. |
| Application Match Review | Expected value, detected evidence, automated status, reviewer status, reason, and evidence. |
| Final reviewer decision | Simple Pass application / Fail application controls with reviewer notes and PDF export. |

## Reviewer Controls

Field decisions:

- `Pass`
- `Fail`

Decision actions:

- `Pass application`
- `Fail application`
- `PDF`

Pass is blocked while unresolved critical failures or reviewer decisions remain. Fail remains available after automated review, with a default fail rationale if the reviewer leaves the note blank.

## Queue

Open `Reviewer Portal` or `Queue` to use queue filters:

- All
- New submissions
- Critical fail
- Missing warning
- ABV mismatch
- Net contents mismatch
- Low confidence
- Needs correction
- Resubmitted
- Assigned to me
- Unassigned
- High-confidence pass

In Backend and Cluster modes, the reviewer queue subscribes to application and review live events and refetches when matching changes arrive.

## PDF Export

Each workbench and decision panel has a `PDF` button. The generated PDF includes:

- Application title, status, source, submitter, and creation time.
- Expected application fields.
- The first image evidence preview when loadable by the browser.
- Field matches, expected values, extracted evidence, status, and reasoning.
- Reviewer notes.
- Processing trace.

## Known Reviewer Boundary

Browser Only is the richest end-to-end reviewer demo. Backend and Cluster modes provide API-backed queue/admin/live integration, but not every browser-snapshot reviewer convenience has an equivalent persisted backend route yet. See [Known_LIMITATIONS.md](Known_LIMITATIONS.md).
