# Government-Style UI Guide

The console uses a USWDS-inspired visual language implemented with Ant Design tokens and local CSS. It is not a direct USWDS component migration, and it is not an official government system.

The interface intentionally avoids official seals, agency badges, official website banners, `.gov` trust language, and any claim of affiliation. A persistent prototype notice appears on every route.

## Palette

- Primary navy: `#1A4480`
- Header navy: `#162E51`
- Interactive blue: `#005EA8`
- Link hover: `#1A6FB3`
- Text: `#1B1B1B`
- Muted text: `#565C65`
- Page background: `#F7F9FA`
- Surface: `#FFFFFF`
- Border: `#DFE1E2`
- Success: `#2E8540`
- Warning: `#FFBE2E`
- Error: `#B50909`
- Focus: `#2491FF`

## Typography

Use Public Sans when available, then Source Sans 3, then system UI fonts. Copy should be plain, direct, and operational.

## Status

Use `GovStatusTag` or `StatusTag` for application and review statuses. Status meaning must be visible in text and never rely on color alone.

## Alerts

Use `GovAlert` for important workflow state:

- Prototype notice
- Action needed
- Review required
- Critical mismatch
- Ready to submit

Alerts should explain what happened and what the user can do next.

## Components

- Use `GovPageShell` for primary pages.
- Use `GovMetricCard` for dashboard metrics.
- Use `GovSummaryBox` for application and review summaries.
- Use `GovProcessTracker` for applicant and reviewer process state.
- Use `GovEmptyState` for empty tables or queues.

## Plain Language

Preferred terms:

- OCR evidence
- Automated finding
- Validator result
- Needs human review
- Reviewer decision
- Evidence confidence
- Field comparison
- Correction request

Avoid implying the OCR/model is the authority. Deterministic validators and human reviewers make review decisions.

## Screenshots

Current evaluator screenshots live in `docs/screenshots`:

- `role-entry.png`
- `reviewer-workbench.png`
- `applicant-workflow.png`
- `admin-operations.png`

Refresh screenshots after major UI changes.

## Accessibility

Follow [UI_ACCESSIBILITY_CHECKLIST.md](UI_ACCESSIBILITY_CHECKLIST.md). Core pages also run Playwright axe scans with WCAG A/AA tags.
