import { describe, expect, it } from "vitest";
import { reviewerEntryApplication } from "../../domain/application/reviewerEntry";
import type { ReviewApplication } from "../../domain/application/types";
import { createDemoSnapshot, createReviewForApplication } from "../../domain/application/demoData";

describe("reviewer entry target", () => {
  it("resumes the active unclassified application", () => {
    const snapshot = createDemoSnapshot();
    const active = snapshot.applications[2];

    expect(reviewerEntryApplication(snapshot.applications, active.id)?.id).toBe(active.id);
  });

  it("advances to the next unclassified application after the active packet is reviewed", () => {
    const snapshot = createDemoSnapshot();
    const reviewed = snapshot.applications[0];
    const applications: ReviewApplication[] = snapshot.applications.map((application) =>
      application.id === reviewed.id
        ? {
            ...application,
            review: createReviewForApplication(application, "browser")
          }
        : application
    );

    expect(reviewerEntryApplication(applications, reviewed.id)?.id).toBe(snapshot.applications[1].id);
  });

  it("wraps to the first unclassified packet when the active reviewed packet is after the remaining work", () => {
    const snapshot = createDemoSnapshot();
    const applications: ReviewApplication[] = snapshot.applications.map((application, index) =>
      index === 0
        ? application
        : {
            ...application,
            review: createReviewForApplication(application, "browser")
          }
    );
    const active = applications[applications.length - 1];

    expect(reviewerEntryApplication(applications, active.id)?.id).toBe(snapshot.applications[0].id);
  });
});
