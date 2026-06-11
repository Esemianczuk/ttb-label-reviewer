# Application Workflow

Phase 6 makes application status changes explicit and auditable. The backend stores canonical application statuses and exposes one transition endpoint instead of letting clients mutate arbitrary state.

## Canonical Statuses

- `DRAFT`
- `PRECHECK_RUNNING`
- `APPLICANT_FIX_REQUIRED`
- `READY_TO_SUBMIT`
- `SUBMITTED`
- `IN_REVIEW`
- `NEEDS_CORRECTION`
- `RESUBMITTED`
- `CONDITIONALLY_APPROVED`
- `APPROVED`
- `REJECTED`
- `WITHDRAWN`
- `ARCHIVED`

## Transition Endpoint

```http
POST /api/applications/{id}/transition
Authorization: Bearer <demo token>
Content-Type: application/json

{
  "transition": "submit",
  "note": "Ready for label review.",
  "fieldKeys": []
}
```

Supported transitions:

| Transition | From | To | Actor |
| --- | --- | --- | --- |
| `run_precheck` | `DRAFT`, `APPLICANT_FIX_REQUIRED` | `PRECHECK_RUNNING` | Applicant/Admin |
| `precheck_pass` | `PRECHECK_RUNNING` | `READY_TO_SUBMIT` | Applicant/Admin |
| `precheck_fail` | `PRECHECK_RUNNING` | `APPLICANT_FIX_REQUIRED` | Applicant/Admin |
| `submit` | `READY_TO_SUBMIT` | `SUBMITTED` | Applicant/Admin |
| `start_review` | `SUBMITTED`, `RESUBMITTED` | `IN_REVIEW` | Reviewer/Admin |
| `request_correction` | `IN_REVIEW` | `NEEDS_CORRECTION` | Reviewer/Admin |
| `resubmit` | `NEEDS_CORRECTION` | `RESUBMITTED` | Applicant/Admin |
| `approve` | `IN_REVIEW` | `APPROVED` | Reviewer/Admin |
| `reject` | `IN_REVIEW` | `REJECTED` | Reviewer/Admin |
| `conditionally_approve` | `IN_REVIEW` | `CONDITIONALLY_APPROVED` | Reviewer/Admin |
| `withdraw` | `DRAFT`, `SUBMITTED` | `WITHDRAWN` | Applicant/Admin |
| `archive` | `APPROVED`, `REJECTED` | `ARCHIVED` | Admin |

## Guards

- `run_precheck` and `submit` require at least one uploaded image.
- `request_correction` requires a note and creates an open correction request.
- `resubmit` requires updated `expectedFields` or `acknowledgedNoChangeCorrection=true`; updated fields create a new application version.
- `reject` requires a reason.
- `approve` blocks unresolved critical failures unless `reviewerOverride=true` and a note is supplied.
- Every successful transition writes an `application.transition` audit event. Authorization denials write `authz.denied`.

Invalid transitions return HTTP 400 with a clear message that includes the current state and allowed source states. Unauthorized transitions return HTTP 403.

## Frontend

The Refine console uses the same canonical statuses for its progress tracker. The tracker compresses the full workflow into six milestones:

1. Draft
2. Precheck
3. Submitted
4. Review
5. Decision
6. Archive

Backend mode can call the transition endpoint through the data provider update path by passing a `transition` field in the application update variables.

## Verification

```bash
python -m pytest apps/api/app/tests/test_phase6_workflow.py -q
npm --prefix apps/console test -- --run
./scripts/check-all.sh
```
