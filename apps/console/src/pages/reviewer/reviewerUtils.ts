import type { ReviewApplication, ReviewField } from "../../domain/application/types";

export type ReviewerQueueFilter =
  | "all"
  | "new_submissions"
  | "critical_fail"
  | "needs_review"
  | "ready_for_decision"
  | "missing_government_warning"
  | "abv_mismatch"
  | "net_contents_mismatch"
  | "low_confidence"
  | "needs_correction"
  | "assigned_to_me"
  | "unassigned"
  | "high_confidence_pass";

export const REVIEWER_QUEUE_FILTERS: Array<{ value: ReviewerQueueFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "new_submissions", label: "New submissions" },
  { value: "critical_fail", label: "Critical fail" },
  { value: "needs_review", label: "Needs review" },
  { value: "ready_for_decision", label: "Ready for decision" },
  { value: "missing_government_warning", label: "Missing warning" },
  { value: "abv_mismatch", label: "ABV mismatch" },
  { value: "net_contents_mismatch", label: "Net contents mismatch" },
  { value: "low_confidence", label: "Low confidence" },
  { value: "needs_correction", label: "Needs correction" },
  { value: "assigned_to_me", label: "Assigned to me" },
  { value: "unassigned", label: "Unassigned" },
  { value: "high_confidence_pass", label: "High-confidence pass" }
];

export function effectiveFieldStatus(field: ReviewField): ReviewField["status"] {
  return field.reviewerStatus || field.status;
}

export function unresolvedCriticalFailures(application: ReviewApplication): ReviewField[] {
  return criticalFields(application);
}

export function criticalFields(application: ReviewApplication): ReviewField[] {
  return (application.review?.fields || []).filter((field) => field.severity === "critical" && !fieldEffectivelyPasses(field));
}

export function lowConfidenceFields(application: ReviewApplication): ReviewField[] {
  return (application.review?.fields || []).filter((field) => field.confidence < 0.78 || effectiveFieldStatus(field) === "NEEDS_REVIEW");
}

export function queuePriority(application: ReviewApplication): { label: string; score: number; tone: "error" | "warning" | "success" | "processing" | "default" } {
  if (application.status === "NEEDS_CORRECTION") return { label: "Correction", score: 95, tone: "warning" };
  if (unresolvedCriticalFailures(application).length) return { label: "Critical", score: 100, tone: "error" };
  if (application.status === "RESUBMITTED") return { label: "Resubmitted", score: 85, tone: "processing" };
  if (lowConfidenceFields(application).length) return { label: "Low confidence", score: 75, tone: "warning" };
  if (application.review?.status === "PASS") return { label: "Fast pass", score: 35, tone: "success" };
  if (application.status === "SUBMITTED") return { label: "New", score: 65, tone: "processing" };
  return { label: "Normal", score: 40, tone: "default" };
}

export function automatedFindingSummary(application: ReviewApplication): string {
  if (!application.review) return "Not processed yet.";
  const critical = unresolvedCriticalFailures(application);
  if (critical.length) return `${critical.length} critical field${critical.length === 1 ? "" : "s"} conflict with label evidence.`;
  const low = lowConfidenceFields(application);
  if (low.length) return `${low.length} low-confidence field${low.length === 1 ? "" : "s"} need specialist review.`;
  if (application.review.status === "PASS") return "High-confidence automated pass.";
  if (application.review.status === "FAIL") return "Automated failure requires reviewer disposition.";
  return application.review.summary;
}

export function criticalFieldLabels(application: ReviewApplication): string {
  const fields = criticalFields(application);
  return fields.length ? fields.map((field) => field.label).join(", ") : "None";
}

export function matchesReviewerFilter(application: ReviewApplication, filter: ReviewerQueueFilter): boolean {
  if (filter === "all") return true;
  if (filter === "new_submissions") return ["SUBMITTED", "READY_TO_SUBMIT", "RESUBMITTED"].includes(application.status);
  if (filter === "critical_fail") return unresolvedCriticalFailures(application).length > 0;
  if (filter === "needs_review") return lowConfidenceFields(application).length > 0 || application.status === "NEEDS_CORRECTION";
  if (filter === "ready_for_decision") return Boolean(application.review && !unresolvedCriticalFailures(application).length);
  if (filter === "missing_government_warning") return fieldNeedsAttention(application, "governmentWarning");
  if (filter === "abv_mismatch") return fieldNeedsAttention(application, "alcoholContent");
  if (filter === "net_contents_mismatch") return fieldNeedsAttention(application, "netContents");
  if (filter === "low_confidence") return lowConfidenceFields(application).length > 0;
  if (filter === "needs_correction") return application.status === "NEEDS_CORRECTION";
  if (filter === "assigned_to_me") return application.assignedTo === "Review Agent";
  if (filter === "unassigned") return !application.assignedTo;
  if (filter === "high_confidence_pass") {
    return Boolean(application.review?.status === "PASS" && application.review.fields.every((field) => field.confidence >= 0.9));
  }
  return true;
}

export function reviewerQueueApplications(applications: ReviewApplication[]): ReviewApplication[] {
  return applications
    .filter((application) => !["WITHDRAWN", "ARCHIVED"].includes(application.status))
    .sort((left, right) => queuePriority(right).score - queuePriority(left).score || Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function fieldNeedsAttention(application: ReviewApplication, fieldKey: ReviewField["fieldKey"]): boolean {
  const field = application.review?.fields.find((candidate) => candidate.fieldKey === fieldKey);
  if (!field) return false;
  return !fieldEffectivelyPasses(field);
}

function fieldEffectivelyPasses(field: ReviewField): boolean {
  return ["PASS", "PASS_WITH_WARNINGS", "NOT_APPLICABLE"].includes(effectiveFieldStatus(field));
}
