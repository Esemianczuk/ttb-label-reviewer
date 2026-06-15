# Architecture

TTB Label Reviewer is local-first. The browser can run alone, and the backend path runs on the evaluator machine with a local FastAPI coordinator and a local PaddleOCR worker.

## Runtime Path

- **Backend primary**: FastAPI persistence, local asset storage, worker/job/audit resources, WebSocket live updates, PaddleOCR OCR, guarded LayoutLMv3 field extraction only when promoted, and deterministic Python validators.
- **Browser fallback**: local snapshot store, packaged Tesseract assets, deterministic JavaScript validators, reviewer edits, and PDF export when the backend is absent.

There is no supported user-facing multi-host processing mode in the shippable demo.

## Components

- `apps/console`: role-based applicant, reviewer, and admin console.
- `apps/api`: FastAPI coordinator, auth/RBAC, applications, assets, reviews, jobs, workers, audit, settings, reports, benchmarks, and static console serving.
- `apps/worker`: local worker that registers with a short-lived token, heartbeats with a persistent worker secret, claims jobs, runs PaddleOCR, returns OCR boxes/text, and performs validation.
- `browser-demo`: browser-only compatibility app and packaged OCR assets.
- `ttb_validation`: deterministic validators shared by backend worker tests and API validation flows.

## Review Flow

1. Applicant or sample fixture creates an application packet.
2. One or more label images are attached.
3. Reviewer starts automation.
4. Backend mode creates OCR, evidence, validation, and report work.
5. Worker runs PaddleOCR full-image OCR.
6. LayoutLMv3 field entities are attached only when a promoted trained model passes the runtime gate; otherwise weak alignment is used conservatively.
7. Deterministic validators compare expected fields against extracted evidence.
8. Reviewer confirms or overrides pass/fail decisions and notes.
9. PDF export records expected values, extracted evidence, statuses, notes, and audit context.

## OCR Contract

OCR payloads keep a stable shape:

- `rawText`
- `blocks`
- `lines`
- `words`
- `metadata`
- `fieldEntities[]` from guarded model spans or conservative weak alignment

Evidence crops come from OCR/entity bounding boxes with padding and image-boundary clamping. Model output is evidence only; deterministic validators remain the compliance authority.

## Worker Security

1. Admin token calls `POST /api/workers/join-token`.
2. Worker registers with that short-lived token.
3. API returns a persistent worker secret once.
4. Heartbeat, claim, complete, fail, and worker operations require the worker secret.
5. Stale workers stop receiving jobs and active leases are returned to the queue.

## Static Serving

`TTB_API_STATIC_DIR` defaults to `apps/console/dist`. When `index.html` exists there, FastAPI serves the console from `/` after API routes.

## Live Updates

Backend mode exposes:

- `WS /api/ws/sessions/{sessionId}`
- `WS /api/ws/workers/{workerId}`

Browser fallback emits equivalent local live-provider events from the snapshot store.
