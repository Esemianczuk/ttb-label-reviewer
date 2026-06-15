import { describe, expect, it } from "vitest";
import { guidanceForPath, type PageGuidance } from "../../layouts/pageGuidance";

function guidanceText(guidance: PageGuidance): string {
  return [
    guidance.scope,
    guidance.title,
    guidance.summary,
    ...guidance.blocks.flatMap((block) => [block.heading, ...block.items]),
    guidance.footer || ""
  ].join(" ");
}

describe("page guidance", () => {
  it("targets the applicant application creation page", () => {
    const guidance = guidanceForPath("/applicant/applications/new", "applicant");
    const text = guidanceText(guidance);

    expect(guidance.title).toBe("New application packet");
    expect(text).toContain("Drag in a JSON, XML, CSV manifest");
    expect(text).toContain("Brand name, class or type, alcohol content");
    expect(text).toContain("not OCR precheck");
  });

  it("targets applicant correction edit mode", () => {
    const guidance = guidanceForPath("/applicant/applications/app-123/edit", "applicant");
    const text = guidanceText(guidance);

    expect(guidance.title).toBe("Edit application packet");
    expect(text).toContain("Read any reviewer notes");
    expect(text).toContain("Fix highlighted fields first");
    expect(text).toContain("Resubmit");
  });

  it("targets the reviewer queue as an informational page", () => {
    const guidance = guidanceForPath("/reviewer/queue", "reviewer");
    const text = guidanceText(guidance);

    expect(guidance.title).toBe("Review queue");
    expect(text).toContain("should not process reviews directly");
    expect(text).toContain("The queue should not show a Process button");
    expect(text).toContain("Clear filters");
  });

  it("targets the reviewer workbench automation policy", () => {
    const guidance = guidanceForPath("/reviewer/applications/app-123", "reviewer");
    const text = guidanceText(guidance);

    expect(guidance.title).toBe("Reviewer workbench");
    expect(text).toContain("Auto-run automation should be checked");
    expect(text).toContain("Run Automation should be available");
    expect(text).toContain("Gray evidence indicates");
  });

  it("targets batch review pause and PDF behavior", () => {
    const guidance = guidanceForPath("/reviewer/batches", "reviewer");
    const text = guidanceText(guidance);

    expect(guidance.title).toBe("Batch review");
    expect(text).toContain("Select All");
    expect(text).toContain("Use Pause or Stop");
    expect(text).toContain("should not trigger a large stack of PDF downloads");
  });

  it("targets sensitive admin pages", () => {
    const retention = guidanceText(guidanceForPath("/admin/retention", "admin"));
    const workers = guidanceText(guidanceForPath("/admin/workers", "admin"));

    expect(retention).toContain("read-only");
    expect(retention).toContain("should not expose delete-all controls");
    expect(workers).toContain("heartbeat age");
    expect(workers).toContain("Unauthenticated or untrusted workers");
  });

  it("falls back to the active role when a route is unknown", () => {
    expect(guidanceForPath("/unknown", "applicant").title).toBe("Applicant workspace guidance");
    expect(guidanceForPath("/unknown", "reviewer").title).toBe("Reviewer workspace guidance");
    expect(guidanceForPath("/unknown", "admin").title).toBe("Operations guidance");
  });
});
