import { describe, expect, it } from "vitest";
import { applicationStatusTokens, reviewStatusTokens, statusMeta } from "../../../theme/statusTokens";

describe("government status tokens", () => {
  it("maps application statuses to plain-language labels", () => {
    expect(applicationStatusTokens.APPLICANT_FIX_REQUIRED).toMatchObject({ label: "Applicant fix required", tone: "warning" });
    expect(applicationStatusTokens.CONDITIONALLY_APPROVED).toMatchObject({ label: "Conditionally approved", tone: "success" });
    expect(applicationStatusTokens.ARCHIVED).toMatchObject({ label: "Archived", tone: "disabled" });
  });

  it("maps review statuses to accessible text labels", () => {
    expect(reviewStatusTokens.NEEDS_REVIEW).toMatchObject({ label: "Needs review", tone: "warning" });
    expect(reviewStatusTokens.NOT_FOUND).toMatchObject({ label: "Not found", tone: "error" });
    expect(reviewStatusTokens.PASS_WITH_WARNINGS).toMatchObject({ label: "Pass with warnings", tone: "warning" });
  });

  it("returns a neutral fallback for unknown statuses", () => {
    expect(statusMeta("SOMETHING_NEW" as never)).toEqual({ label: "SOMETHING_NEW", tone: "neutral" });
  });
});
