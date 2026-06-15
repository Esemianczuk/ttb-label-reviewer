import type { UserRole } from "../domain/application/types";

export type PageGuidanceBlock = {
  heading: string;
  items: string[];
};

export type PageGuidance = {
  scope: string;
  title: string;
  summary: string;
  blocks: PageGuidanceBlock[];
  footer?: string;
};

type RouteMatcher = {
  match: (path: string) => boolean;
  guidance: PageGuidance;
};

export function guidanceForPath(pathname: string, role: UserRole): PageGuidance {
  const path = normalizePath(pathname);
  const page = guidanceRoutes.find((route) => route.match(path));
  return page?.guidance || fallbackGuidance(role);
}

function normalizePath(pathname: string): string {
  const path = pathname.split("?")[0]?.replace(/\/+$/, "") || "/";
  return path || "/";
}

function exact(pathname: string): (path: string) => boolean {
  return (path) => path === pathname;
}

function pattern(regex: RegExp): (path: string) => boolean {
  return (path) => regex.test(path);
}

function page(scope: string, title: string, summary: string, blocks: PageGuidanceBlock[], footer?: string): PageGuidance {
  return { scope, title, summary, blocks, footer };
}

function fallbackGuidance(role: UserRole): PageGuidance {
  if (role === "applicant") {
    return page(
      "Applicant",
      "Applicant workspace guidance",
      "Use the applicant workspace to create application packets, manage drafts, submit label images, and respond to reviewer correction requests.",
      [
        {
          heading: "Start here",
          items: [
            "Open Dashboard for the active packet list, or New Application when you are ready to submit a fresh packet.",
            "Use Drafts for packets that have been started but not submitted.",
            "Use Needs Attention when a reviewer has asked for corrections."
          ]
        },
        {
          heading: "Before leaving",
          items: [
            "Confirm the packet has a clear application number, company, product type, label image, and required label fields.",
            "Correction packets should be resubmitted from the edit screen after the highlighted issue is addressed.",
            "Archive only the packets you want hidden from the active working lists."
          ]
        }
      ],
      "Applicant uploads and imported documents use the backend when available; browser-local processing is the offline fallback."
    );
  }

  if (role === "admin") {
    return page(
      "Admin",
      "Operations guidance",
      "Use admin pages to monitor backend health, worker behavior, OCR policy, jobs, audit events, retention posture, fixtures, and benchmark results.",
      [
        {
          heading: "Start here",
          items: [
            "Open Dashboard for the health overview, then drill into Workers, Jobs, Audit Log, or OCR Engines when a metric needs explanation.",
            "Treat Data Retention and Settings as read-only policy posture for the assessment console.",
            "Use Benchmarks to inspect browser fallback and backend PaddleOCR throughput without changing reviewer decisions."
          ]
        },
        {
          heading: "Before leaving",
          items: [
            "Confirm workers are healthy, jobs are not stuck in leased or retrying states, and permission failures are intentional.",
            "Browser fallback should only appear when the coordinator is not reachable.",
            "Use audit records to verify overrides, role changes, and sensitive operation failures."
          ]
        }
      ],
      "Admin tools are intentionally separated from reviewer and applicant workflows."
    );
  }

  return page(
    "Reviewer",
    "Reviewer workspace guidance",
    "Use reviewer pages to triage submitted applications, run deterministic OCR-assisted checks, compare evidence, and record a final pass or fail decision.",
    [
      {
        heading: "Start here",
        items: [
          "Open Dashboard for the highest-priority review counts, or Review Queue when you need detailed sorting and filtering.",
          "Open a packet to run automation, compare expected values with extracted evidence, and adjust field pass or fail states.",
          "Use Batch Review for selected unprocessed packets when you want the automation to work through a group."
        ]
      },
      {
        heading: "Before leaving",
        items: [
          "Make sure every critical issue has a reviewer decision and the final application disposition is closed.",
          "Download the PDF report from the reviewed workbench when a permanent handoff artifact is needed.",
          "Use Reopen only when a closed packet needs another human decision."
        ]
      }
    ],
    "OCR output is evidence for the reviewer. The deterministic validators and human decision remain the authority."
  );
}

const guidanceRoutes: RouteMatcher[] = [
  {
    match: exact("/"),
    guidance: page(
      "Start",
      "Choose a demo role",
      "This screen is the fastest way to enter the demo as the type of person you want to test: applicant, reviewer, or admin.",
      [
        {
          heading: "Choose the right role",
          items: [
            "Applicant creates or edits label application packets.",
            "Reviewer opens submitted packets, runs automation, checks evidence, and records pass or fail decisions.",
            "Admin monitors backend health, workers, jobs, audit events, settings, fixtures, and benchmarks."
          ]
        },
        {
          heading: "If the demo state feels stale",
          items: [
            "Use Reset Demo from the top bar to restore the sample applications and clear local review changes.",
            "Browser-only mode works without a backend and keeps uploaded images local to the browser.",
            "Backend mode is the optional path for testing service and worker behavior."
          ]
        }
      ],
      "The demo is not an official TTB service and does not create a legal determination."
    )
  },
  {
    match: exact("/applicant"),
    guidance: page(
      "Applicant",
      "Applicant dashboard",
      "Use this dashboard as the active packet list for the applicant account. It is where new packets start and where submitted, correction, and archived packets are organized.",
      [
        {
          heading: "Do this first",
          items: [
            "Open Needs Attention before starting new work so correction requests do not sit unnoticed.",
            "Use Create Application Packet when a new label package is ready to enter.",
            "Use Archive only for packets that should be hidden from active applicant work."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "Each packet should show an application number, company, product type, status, and application date.",
            "Draft packets should remain editable; submitted packets should preserve the submitted application values.",
            "Correction packets should open into the application edit screen with reviewer notes visible."
          ]
        },
        {
          heading: "Watch for",
          items: [
            "Drafts autosave once the applicant starts creating a packet.",
            "Archived packets are hidden from the active lists until restored.",
            "Needs Attention means the reviewer expects the applicant to revise and resubmit."
          ]
        }
      ]
    )
  },
  {
    match: exact("/applicant/drafts"),
    guidance: page(
      "Applicant",
      "Draft packets",
      "Drafts are packets that have been started but not submitted. They should be easy to resume, correct, or remove.",
      [
        {
          heading: "Do this first",
          items: [
            "Open the most recent draft when continuing a partially entered application.",
            "Delete drafts that were only test starts or accidental duplicates.",
            "Check application numbers and product names before deciding which draft to resume."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "The draft should keep uploaded images, imported form data, and manually entered values.",
            "Required fields that are still missing should remain visibly called out in the edit form.",
            "Submitting the draft should move it out of Drafts and into Submitted."
          ]
        }
      ]
    )
  },
  {
    match: exact("/applicant/submitted"),
    guidance: page(
      "Applicant",
      "Submitted packets",
      "Submitted shows packets that have left the applicant draft state and are waiting for reviewer action or have already been reviewed.",
      [
        {
          heading: "Do this first",
          items: [
            "Sort or scan by application date when checking what was sent most recently.",
            "Open a packet to confirm the submitted fields and label images are the ones intended.",
            "Watch status changes so correction requests or final dispositions do not get missed."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "Submitted and resubmitted packets should have stable application numbers and application data.",
            "Packets needing correction should move to the Needs Attention workflow instead of requiring a separate response page.",
            "Approved, rejected, or withdrawn packets should be treated as closed applicant work unless reopened by process."
          ]
        }
      ]
    )
  },
  {
    match: exact("/applicant/attention"),
    guidance: page(
      "Applicant",
      "Needs attention",
      "This view is for applications where the reviewer found an issue and expects the applicant to revise the packet.",
      [
        {
          heading: "Do this first",
          items: [
            "Open the application and use the edit screen rather than writing a separate correction response.",
            "Read the reviewer note before changing fields so the fix addresses the actual issue.",
            "Look for highlighted fields; those are the parts most likely tied to the reviewer concern."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "Correct the erroneous application value or replace the wrong label image before resubmitting.",
            "Add an applicant note only when it helps explain the change, withdrawal, or new version.",
            "Resubmit only after the corrected packet reflects what should be reviewed next."
          ]
        }
      ]
    )
  },
  {
    match: exact("/applicant/archived"),
    guidance: page(
      "Applicant",
      "Archived packets",
      "Archived packets are hidden from normal applicant work without deleting the record.",
      [
        {
          heading: "Do this first",
          items: [
            "Use this view when a packet is missing from active lists and may have been archived.",
            "Unarchive a packet when it needs more applicant action or should return to normal visibility.",
            "Leave old test packets archived when they are not part of the current review story."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "Unarchived packets should return to the appropriate active list based on status.",
            "Archived packets should keep application numbers, submitted data, images, and audit history.",
            "Archiving should not be used as a substitute for withdrawal when the application should be formally closed."
          ]
        }
      ]
    )
  },
  {
    match: exact("/applicant/applications/new"),
    guidance: page(
      "Applicant",
      "New application packet",
      "Create a packet by importing application data, dropping label images, or manually filling the form. The applicant side is about submission, not OCR precheck.",
      [
        {
          heading: "Do this first",
          items: [
            "Drag in a JSON, XML, CSV manifest, or compatible application-data file when one is available.",
            "Drag in one or more label images, then confirm the primary image is the image the reviewer should inspect.",
            "Manually fill any fields that could not be imported from the application data."
          ]
        },
        {
          heading: "Fields to check",
          items: [
            "Brand name, class or type, alcohol content, net contents, and producer or bottler should be clear.",
            "Country of origin matters for imports and should be present when applicable.",
            "Government warning text is mandatory on alcohol beverage labels and should be part of the submitted label evidence."
          ]
        },
        {
          heading: "Verify before submitting",
          items: [
            "Missing required values should be highlighted and should be resolved before the packet is submitted.",
            "The application number should be visible so the packet can be tracked across applicant, reviewer, and audit pages.",
            "Once submitted, the reviewer runs automation and makes the final pass or fail decision."
          ]
        }
      ]
    )
  },
  {
    match: pattern(/^\/applicant\/applications\/[^/]+\/edit$/),
    guidance: page(
      "Applicant",
      "Edit application packet",
      "Use edit mode to finish a draft, correct a reviewer issue, create a new version, withdraw, or resubmit the packet.",
      [
        {
          heading: "Do this first",
          items: [
            "Read any reviewer notes before changing fields or replacing images.",
            "Fix highlighted fields first; those are the values most likely tied to correction requests.",
            "Use drag and drop to replace or add label images when the original evidence was wrong or incomplete."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "The corrected value should match the label image the reviewer will see.",
            "Applicant notes should explain material changes, not repeat the form values.",
            "Resubmit, create a new version, or withdraw based on what should happen next in the workflow."
          ]
        }
      ]
    )
  },
  {
    match: pattern(/^\/applicant\/applications\/[^/]+\/timeline$/),
    guidance: page(
      "Applicant",
      "Application timeline",
      "The timeline explains what happened to one packet over time: creation, edits, submission, corrections, reviewer decisions, and audit events.",
      [
        {
          heading: "Do this first",
          items: [
            "Scan the newest events first when trying to understand the current status.",
            "Use event timestamps and actor names to separate applicant changes from reviewer or admin actions.",
            "Compare correction and resubmission events when a packet has multiple review rounds."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "The timeline should include important state changes and permission-sensitive actions.",
            "Application numbers should match the packet being discussed elsewhere in the console.",
            "Unexpected denials or role problems should also appear in audit records for admin review."
          ]
        }
      ]
    )
  },
  {
    match: pattern(/^\/applicant\/applications\/[^/]+$/),
    guidance: page(
      "Applicant",
      "Application details",
      "Use details to inspect a packet without losing its submitted context. Correction packets should move into edit mode when applicant action is needed.",
      [
        {
          heading: "Do this first",
          items: [
            "Confirm the application number, status, company, product type, and submitted date.",
            "Open edit mode only when the packet is a draft or needs applicant correction.",
            "Use the timeline when you need to understand how the packet reached its current status."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "Submitted application values should remain stable unless the applicant is creating a new version or correcting a request.",
            "Reviewer notes should be visible when a packet needs correction.",
            "Closed packets should not look editable unless the workflow explicitly allows another action."
          ]
        }
      ]
    )
  },
  {
    match: exact("/reviewer"),
    guidance: page(
      "Reviewer",
      "Reviewer dashboard",
      "The dashboard is the reviewer home base: it shows workload, important risk buckets, and quick paths into the packets that need review.",
      [
        {
          heading: "Do this first",
          items: [
            "Use New Submissions, Critical Mismatches, Needs Review, and Ready for Decision as clickable triage shortcuts.",
            "Open the filtered Review Queue when you need a sortable list before choosing a packet.",
            "Open a workbench when you are ready to compare the application values against label evidence."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "A dashboard count should match the filtered queue it opens.",
            "Critical issues should describe the actual problem, such as missing warning text or a field mismatch.",
            "Closed packets should move out of active review buckets unless reopened."
          ]
        },
        {
          heading: "Watch for",
          items: [
            "Automation is evidence gathering. The reviewer still owns final pass or fail decisions.",
            "Application numbers are the tracking handle across workbench, PDFs, and audit logs.",
            "Use Reset Demo if every sample has already been processed and you want a fresh walkthrough."
          ]
        }
      ]
    )
  },
  {
    match: exact("/reviewer/queue"),
    guidance: page(
      "Reviewer",
      "Review queue",
      "Use the queue to find the right packet before opening the workbench. It is informational and should not process reviews directly.",
      [
        {
          heading: "Do this first",
          items: [
            "Filter by issue type, processing state, company, product type, reviewer, or date range.",
            "Sort columns when you need the oldest, newest, highest-risk, or most complete applications first.",
            "Expand a row for context, then open the packet when it is ready for actual review."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "The queue should not show a Process button; automation belongs in the workbench or batch review.",
            "Long field values should stay readable without overlapping adjacent columns.",
            "Clear filters when returning from a dashboard shortcut and you want the full queue again."
          ]
        }
      ]
    )
  },
  {
    match: pattern(/^\/reviewer\/applications\/[^/]+$/),
    guidance: page(
      "Reviewer",
      "Reviewer workbench",
      "The workbench is where the reviewer runs automation, compares expected application values with extracted label evidence, reviews crops or full images, and records final pass or fail.",
      [
        {
          heading: "Do this first",
          items: [
            "If the packet has not been reviewed yet, Auto-run automation should be checked and Run Automation should be available.",
            "If you arrived by pressing Next Application with auto-run checked, the next packet should start processing automatically.",
            "Use Rerun Automation only when the packet already has a review and you want to refresh the OCR evidence."
          ]
        },
        {
          heading: "Compare evidence",
          items: [
            "Read each row left to right: field name, application value, extracted label evidence, evidence crop or full image option, and final pass or fail.",
            "Pass evidence should show the crop that supports the extracted value; fail evidence should make it easy to expand the full image and inspect manually.",
            "Raw OCR opens near the PDF action when the reviewer needs the complete recognized text."
          ]
        },
        {
          heading: "Reviewer decisions",
          items: [
            "Switch a field between Pass and Fail when human review disagrees with the automation.",
            "Notes are available but not required for every field; use them when the reason would help an audit reader.",
            "After final Pass or Fail, the workbench should close the decision controls and show Next Application or Reopen."
          ]
        }
      ],
      "Gray evidence indicates the reviewer overrode the automated finding."
    )
  },
  {
    match: exact("/reviewer/batches"),
    guidance: page(
      "Reviewer",
      "Batch review",
      "Batch review is for selecting unprocessed packets and letting automation work through them as a group.",
      [
        {
          heading: "Do this first",
          items: [
            "Use filters and sorting to narrow the list by company, application date, product type, status, or processing state.",
            "Select individual packets or use Select All for the visible filtered set.",
            "Process Open Batch should stay disabled until at least one unprocessed packet is selected."
          ]
        },
        {
          heading: "During processing",
          items: [
            "Watch the progress animation and status text to see which packet is being processed.",
            "Use Pause or Stop when you need to regain control without losing completed results.",
            "Batch processing should not trigger a large stack of PDF downloads."
          ]
        },
        {
          heading: "After processing",
          items: [
            "Open a reviewed packet to inspect the workbench and download its PDF report.",
            "If all demo applications are already processed, use the reset prompt to restore batch-mode test data.",
            "Packets that fail automation still require reviewer inspection before final disposition."
          ]
        }
      ]
    )
  },
  {
    match: exact("/reviewer/reports"),
    guidance: page(
      "Reviewer",
      "Reviewer reports",
      "Reports summarize reviewed packets, final outcomes, decision reasons, and downloadable review artifacts.",
      [
        {
          heading: "Do this first",
          items: [
            "Filter or scan by application number, company, product type, decision, and review date.",
            "Open the workbench for any report that needs evidence-level inspection.",
            "Download the PDF report when a professional handoff document is needed."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "A report should include submitted data, extracted evidence, reviewer overrides, notes, and final disposition.",
            "Application numbers should match the workbench and audit trail.",
            "Reports should not replace the workbench for active decisions that are not yet closed."
          ]
        }
      ]
    )
  },
  {
    match: exact("/admin"),
    guidance: page(
      "Admin",
      "Admin operations dashboard",
      "Use the admin dashboard to confirm the system is healthy before reviewers rely on backend processing.",
      [
        {
          heading: "Do this first",
          items: [
            "Check backend health, active worker count, job counts, recent failures, and audit activity.",
            "Open Workers when heartbeat or capability status looks suspicious.",
            "Open Jobs when queue depth, retries, or failures need investigation."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "Browser-only mode should be understood as local processing; backend mode depends on coordinator and worker availability.",
            "Worker sophistication should be visible even when the demo uses mock or null workers.",
            "Audit events should capture permission failures and sensitive transitions."
          ]
        }
      ]
    )
  },
  {
    match: exact("/admin/workers"),
    guidance: page(
      "Admin",
      "Worker operations",
      "Workers perform OCR and review jobs. This page explains whether they are alive, capable, and safe to receive work.",
      [
        {
          heading: "Do this first",
          items: [
            "Check heartbeat age, status, capabilities, engine, worker host, and current lease.",
            "Use drain when a worker should finish current work but stop accepting new jobs.",
            "Compare browser fallback and backend worker behavior when evaluating processing performance."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "Stale workers should eventually stop receiving jobs.",
            "Unauthenticated or untrusted workers should not be allowed to claim jobs.",
            "Worker changes should appear in audit or live updates when relevant."
          ]
        }
      ]
    )
  },
  {
    match: exact("/admin/jobs"),
    guidance: page(
      "Admin",
      "Job operations",
      "Jobs show OCR and review work moving through queued, leased, running, completed, failed, cancelled, or retrying states.",
      [
        {
          heading: "Do this first",
          items: [
            "Filter by state when the queue is busy or when a specific application number is under investigation.",
            "Check queue time, worker assignment, lease age, retry count, and failure reason.",
            "Retry only when the failure is recoverable and the input data is still valid."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "Completed jobs should update the related review or application view without refresh.",
            "Failed jobs should preserve an actionable reason instead of silently disappearing.",
            "Cancelled or expired leases should not leave the packet stuck in a running state."
          ]
        }
      ]
    )
  },
  {
    match: exact("/admin/audit"),
    guidance: page(
      "Admin",
      "Audit log",
      "The audit log is the source of truth for sensitive events: permission failures, role changes, overrides, transitions, purges, and worker actions.",
      [
        {
          heading: "Do this first",
          items: [
            "Filter by actor, application number, action type, role, or time range.",
            "Look for permission failures when a user reports that a page or action behaved unexpectedly.",
            "Use override and transition events to reconstruct how a final review decision was reached."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "Sensitive failures should be logged without exposing raw secrets or private image data.",
            "Application numbers should make events easy to connect to applicant and reviewer pages.",
            "Retention and purge events should be easy to distinguish from ordinary edits."
          ]
        }
      ]
    )
  },
  {
    match: exact("/admin/roles"),
    guidance: page(
      "Admin",
      "Role model",
      "Roles define which account can see and change applicant, reviewer, and operations data.",
      [
        {
          heading: "Do this first",
          items: [
            "Confirm applicant, reviewer, and admin permissions are separated by default.",
            "Review ownership-sensitive actions such as applicant cross-read, reviewer decisions, worker controls, and retention.",
            "Use this page to reason about future account expansion without weakening the demo defaults."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "A user should not see navigation for pages their role cannot access.",
            "Switching accounts should redirect away from stale pages into that role's dashboard.",
            "Permission denials should be logged for sensitive actions."
          ]
        }
      ]
    )
  },
  {
    match: exact("/admin/users"),
    guidance: page(
      "Admin",
      "User accounts",
      "User accounts represent the demo identities and the ownership boundaries that real accounts would enforce.",
      [
        {
          heading: "Do this first",
          items: [
            "Confirm the default applicant, reviewer, and admin accounts have the expected role labels.",
            "Check ownership when an applicant packet should only be visible to its applicant account.",
            "Use account state to validate the role switcher and redirect behavior."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "Applicants should not see reviewer or admin navigation.",
            "Reviewers should not see applicant draft creation tools.",
            "Admins should use operations tools without becoming the applicant or reviewer decision maker."
          ]
        }
      ]
    )
  },
  {
    match: exact("/admin/settings"),
    guidance: page(
      "Admin",
      "System policy",
      "Settings show the locked policy values used by the assessment console. They are displayed for review, not edited from the UI.",
      [
        {
          heading: "Do this first",
          items: [
            "Confirm the runtime path shows backend primary when the coordinator is reachable.",
            "Review any LAN or CORS warning before exposing the backend beyond localhost.",
            "Check upload limits and security defaults before testing large or unusual files."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "Production-style paths should not depend on a CDN by default.",
            "The backend URL should be visible as coordinator context, not as a reviewer control.",
            "Policy values should not leak into applicant or reviewer pages as distracting technical controls."
          ]
        }
      ]
    )
  },
  {
    match: exact("/admin/engines"),
    guidance: page(
      "Admin",
      "OCR engine policy",
      "OCR policy explains the primary PaddleOCR backend path and the browser-local fallback used only when the backend is absent.",
      [
        {
          heading: "Do this first",
          items: [
            "Confirm PaddleOCR is the primary backend recognizer.",
            "Review worker count, concurrency, and capability probes before running backend OCR tests.",
            "Check whether the guarded field extractor is active or whether weak alignment is the safe baseline."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "Browser fallback should remain local to the browser.",
            "Backend extraction should preserve deterministic validation as the authority.",
            "Engine status should show PaddleOCR field alignment as the backend authority and browser OCR only as fallback."
          ]
        }
      ]
    )
  },
  {
    match: exact("/admin/benchmarks"),
    guidance: page(
      "Admin",
      "Benchmarks",
      "Benchmarks compare processing speed across one image, larger batches, browser fallback, and backend PaddleOCR mode.",
      [
        {
          heading: "Do this first",
          items: [
            "Load the latest benchmark JSON when comparing recent runs.",
            "Check total time, images per minute, p50, p95, OCR time, validation time, queue time, worker chosen, engine used, and failures.",
            "Run quick benchmarks when you need confidence without GPU-dependent tests."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "Results should save under benchmarks/results for repeatable evaluator review.",
            "Backend results should only be compared when a worker was actually available.",
            "Performance numbers should explain throughput, not imply legal review quality."
          ]
        }
      ]
    )
  },
  {
    match: exact("/admin/retention"),
    guidance: page(
      "Admin",
      "Data retention",
      "Retention policy is read-only in the assessment console so evaluators cannot accidentally delete the demo state.",
      [
        {
          heading: "Do this first",
          items: [
            "Review raw image and job retention windows.",
            "Treat this page as policy posture only; do not change or purge demo data from operations pages.",
            "Confirm storage estimates are understandable without exposing destructive controls."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "Retention endpoints should remain covered by backend RBAC tests.",
            "The admin page should not expose delete-all controls during evaluator review.",
            "Audit records should still make sensitive backend operations visible when tests exercise them."
          ]
        }
      ],
      "This page demonstrates operational readiness without letting the UI erase the working demo."
    )
  },
  {
    match: exact("/admin/fixtures"),
    guidance: page(
      "Admin",
      "Fixture management",
      "Fixtures are the sample COLA records and label images used to demonstrate applicant, reviewer, and OCR flows.",
      [
        {
          heading: "Do this first",
          items: [
            "Confirm fixture count, source, application numbers, image availability, and required field coverage.",
            "Look for missing brand, class or type, alcohol content, net contents, producer, origin, or warning fields before using a fixture in the demo.",
            "Prefer real public COLA records over synthetic examples when they have enough metadata and imagery to support review."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "Fixtures should not include dead image paths or unreviewable records.",
            "Each fixture should make it clear which values are expected and what label evidence supports them.",
            "Demo reset should reload the same curated fixture set."
          ]
        }
      ]
    )
  },
  {
    match: pattern(/^\/resources\/[^/]+(?:\/[^/]+)?$/),
    guidance: page(
      "Resources",
      "Resource view",
      "Resource pages expose low-level records for diagnostics. They are useful for inspection, but normal work should happen in the applicant, reviewer, or admin workflows.",
      [
        {
          heading: "Do this first",
          items: [
            "Confirm you are viewing the expected resource type before making conclusions.",
            "Use application numbers and IDs to connect raw records back to the main workflow pages.",
            "Return to the role dashboard when the task belongs to applicant submission, reviewer decisions, or admin operations."
          ]
        },
        {
          heading: "Verify before leaving",
          items: [
            "Resource data should agree with the user-facing page that owns the workflow.",
            "Permission-sensitive data should only appear for accounts allowed to view it.",
            "Raw resource views should not be the primary path for evaluator demo tasks."
          ]
        }
      ]
    )
  }
];
