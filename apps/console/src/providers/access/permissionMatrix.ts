import type { AccessControlProvider } from "@refinedev/core";
import type { UserRole } from "../../domain/application/types";
import { getStoredRole } from "../auth/authProvider";

type Rule = {
  resource: string;
  actions: string[];
};

export const permissionMatrix: Record<UserRole, Rule[]> = {
  applicant: [
    { resource: "applications", actions: ["list", "show", "create", "update", "delete", "submit", "resubmit", "upload", "download", "withdraw", "archive", "unarchive"] },
    { resource: "applicationVersions", actions: ["list", "show", "create"] },
    { resource: "labelAssets", actions: ["list", "show", "create"] },
    { resource: "reviews", actions: ["show", "download"] },
    { resource: "correctionRequests", actions: ["list", "show"] },
    { resource: "auditEvents", actions: ["list"] },
    { resource: "reports", actions: ["download"] }
  ],
  reviewer: [
    { resource: "applications", actions: ["list", "show", "update", "review", "download"] },
    { resource: "reviews", actions: ["list", "show", "update", "override", "download"] },
    { resource: "correctionRequests", actions: ["list", "show", "create"] },
    { resource: "auditEvents", actions: ["list"] },
    { resource: "reports", actions: ["list", "download"] }
  ],
  admin: [
    { resource: "users", actions: ["list", "show"] },
    { resource: "workers", actions: ["list", "show"] },
    { resource: "jobs", actions: ["list", "show"] },
    { resource: "benchmarks", actions: ["list", "show", "run"] },
    { resource: "auditEvents", actions: ["list", "show", "download"] },
    { resource: "fixtures", actions: ["list", "show"] },
    { resource: "settings", actions: ["list", "show"] }
  ]
};

export function canAccess(role: UserRole, resource = "", action = ""): boolean {
  return permissionMatrix[role].some((rule) => {
    const resourceMatches = rule.resource === "*" || rule.resource === resource;
    const actionMatches = rule.actions.includes("*") || rule.actions.includes(action);
    return resourceMatches && actionMatches;
  });
}

export const accessControlProvider: AccessControlProvider = {
  can: async ({ resource, action }) => {
    const role = getStoredRole();
    const can = canAccess(role, resource, action);
    return {
      can,
      reason: can ? undefined : `${role} cannot ${action} ${resource}.`
    };
  },
  options: {
    buttons: {
      enableAccessControl: true,
      hideIfUnauthorized: true
    }
  }
};
