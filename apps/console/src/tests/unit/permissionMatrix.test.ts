import { describe, expect, it } from "vitest";
import { canAccess } from "../../providers/access/permissionMatrix";

describe("permission matrix", () => {
  it("lets applicants create applications but not override reviews", () => {
    expect(canAccess("applicant", "applications", "create")).toBe(true);
    expect(canAccess("applicant", "reviews", "override")).toBe(false);
  });

  it("lets reviewers update review decisions without admin-wide settings access", () => {
    expect(canAccess("reviewer", "reviews", "override")).toBe(true);
    expect(canAccess("reviewer", "settings", "update")).toBe(false);
  });

  it("lets admins access every resource and action", () => {
    expect(canAccess("admin", "settings", "update")).toBe(true);
    expect(canAccess("admin", "workers", "recalibrate")).toBe(true);
  });
});
