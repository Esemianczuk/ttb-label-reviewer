import type { ReviewApplication } from "./types";

const hiddenReviewerStatuses = new Set(["ARCHIVED", "WITHDRAWN"]);
const classifiedReviewerStatuses = new Set(["APPROVED", "CONDITIONALLY_APPROVED", "REJECTED"]);

export function isReviewerClassified(application: ReviewApplication): boolean {
  return Boolean(application.review) || classifiedReviewerStatuses.has(application.status);
}

export function reviewerEntryApplication(
  applications: ReviewApplication[],
  activeApplicationId?: string
): ReviewApplication | undefined {
  const reviewable = applications.filter((application) => !hiddenReviewerStatuses.has(application.status));
  if (!reviewable.length) return undefined;

  const activeIndex = reviewable.findIndex((application) => application.id === activeApplicationId);
  const active = activeIndex >= 0 ? reviewable[activeIndex] : undefined;
  if (active && !isReviewerClassified(active)) return active;

  if (activeIndex >= 0) {
    const nextUnclassified = reviewable.slice(activeIndex + 1).find((application) => !isReviewerClassified(application));
    if (nextUnclassified) return nextUnclassified;
  }

  return reviewable.find((application) => !isReviewerClassified(application)) || active || reviewable[0];
}
