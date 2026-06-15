# Console App

`apps/console` is the role-based evaluator console. It defaults to the backend path and falls back to browser-local OCR only when the backend is absent.

## Runtime Path

- **Backend primary**: uses FastAPI resources, live updates, local asset storage, worker/job/audit endpoints, and a local PaddleOCR worker.
- **Browser fallback**: uses browser-local state, packaged OCR assets, uploads kept in the browser, deterministic validators, and local PDF export.

Admins can inspect the active runtime path, but cannot switch modes from the UI. Applicant and reviewer screens stay focused on their work.

## Roles

- **Applicant**: creates packets, uploads images and application data, edits drafts, submits, archives, and responds to reviewer feedback by editing the packet.
- **Reviewer**: opens queue items, runs automation, compares expected values against extracted evidence, toggles pass/fail, adds notes, exports PDFs, and advances to the next application.
- **Admin**: monitors backend health, workers, jobs, OCR engine status, benchmarks, audit, settings, fixtures, and retention.

## Backend OCR

Backend automation uses PaddleOCR full-image OCR. If a trained LayoutLMv3 field extractor is staged at `models/field-extractor/layoutlmv3-cola/current`, backend workers use it to select field evidence. If the model is absent, the worker reports baseline mode and uses conservative weak alignment.

Deterministic validators remain the pass/fail authority.
