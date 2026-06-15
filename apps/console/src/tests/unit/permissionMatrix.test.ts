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
    expect(canAccess("reviewer", "workers", "list")).toBe(false);
  });

  it("lets admins inspect operations without destructive admin actions", () => {
    expect(canAccess("admin", "settings", "show")).toBe(true);
    expect(canAccess("admin", "workers", "list")).toBe(true);
    expect(canAccess("admin", "jobs", "show")).toBe(true);
    expect(canAccess("admin", "benchmarks", "run")).toBe(true);
    expect(canAccess("admin", "settings", "update")).toBe(false);
    expect(canAccess("admin", "workers", "recalibrate")).toBe(false);
    expect(canAccess("admin", "jobs", "cancel")).toBe(false);
  });
});
