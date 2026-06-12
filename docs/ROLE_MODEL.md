# Role Model

The assessment demo has three human roles and one machine identity type. The role model is intentionally small so an evaluator can switch contexts quickly while still seeing permission boundaries.

This is demo auth, not production SSO.

## Human Roles

| Role | Console entry | Primary workspace | Intended actions |
| --- | --- | --- | --- |
| Applicant | `Continue as Applicant` or sidebar role selector | `/applicant` | Create application packets, upload label images, submit, update/resubmit correction packets, withdraw, download packet reports. |
| Reviewer | `Continue as Reviewer` or sidebar role selector | `/reviewer` | Review queue, inspect images/evidence/OCR text, override field decisions with reasons, request corrections, approve/reject/escalate, export PDFs. |
| Admin | `Continue as Admin` or sidebar role selector | `/admin` | Inspect users/roles/workers/jobs/audit/fixtures/benchmarks, adjust settings, run retention actions, control workers and jobs. |

The console stores the current role in local storage as `ttb-console-role`. The sidebar selector changes this local role and updates visible navigation. Route guards hide or block workspaces outside the selected role.

## API Demo Users

Backend mode seeds three demo users:

| Role | Demo email | Boundary |
| --- | --- | --- |
| applicant | `applicant@example.local` | Own application packets and corrected resubmissions. |
| reviewer | `reviewer@example.local` | Review operations and read-only worker visibility. |
| admin | `admin@example.local` | Coordinator operations, worker/job management, settings, retention, and benchmarks. |

`POST /api/auth/demo-login` returns a signed bearer token for one of these roles. Backend routes enforce role and ownership checks; the UI controls are not the only guard.

## Permission Matrix

| Resource | Applicant | Reviewer | Admin |
| --- | --- | --- | --- |
| Applications | list/show/create/update/submit/resubmit/upload/download/withdraw owned packets | list/show/update/review/download | all |
| Application versions | list/show/create owned versions | no direct route | all |
| Label assets | list/show/create owned assets | evidence read through review routes | all |
| Reviews | show/download own reviews | list/show/update/override/download | all |
| Correction requests | list/show | list/show/create | all |
| Reports | download own reports | list/download | all |
| Audit events | list scoped events | list review events | list/show/manage/download |
| Workers/jobs/settings/benchmarks/fixtures | no access | worker list only | manage |

See `apps/console/src/providers/access/permissionMatrix.ts` for the exact console matrix.

## Worker Identity

Workers are not human users. A worker registers with a short-lived join token and receives a persistent worker secret. That secret can heartbeat, claim jobs, complete jobs, fail jobs, and recalibrate the worker, but it cannot call applicant, reviewer, or admin human endpoints.

Worker security expectations:

- First registration requires a join token by default.
- Later calls use `Authorization: Bearer <worker secret>`.
- Stale workers must heartbeat before claiming more jobs.
- Unauthenticated job claims are denied and audited.

## Evaluator Checks

1. Open `/` and click `Continue as Reviewer`.
2. Use the sidebar role selector to switch to `Applicant`; reviewer/admin menu items disappear.
3. Switch to `Admin`; workers, jobs, audit, benchmarks, retention, fixtures, and settings appear.
4. In Backend mode, use demo-login tokens to verify applicants cannot cross-read another applicant's packet and reviewers cannot purge retention data.
