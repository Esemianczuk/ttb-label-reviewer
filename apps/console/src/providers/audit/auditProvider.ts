import type { AuditLogProvider } from "@refinedev/core";
import { createAudit } from "../../domain/application/demoData";
import { getStoredRole } from "../auth/authProvider";
import { getSnapshot } from "../data/browserStore";

const localAuditBuffer: any[] = [];

export const auditLogProvider: AuditLogProvider = {
  create: async ({ resource, action, data, author, meta }) => {
    const event = createAudit(
      `audit-refine-${Date.now()}`,
      author?.name || "Console",
      getStoredRole(),
      action,
      resource,
      `${action} ${resource}`,
      { data, meta }
    );
    localAuditBuffer.unshift(event);
    return event;
  },
  get: async ({ resource, action }) => {
    const events = [...localAuditBuffer, ...getSnapshot().auditEvents].filter((event) => {
      if (resource && event.resource !== resource) return false;
      if (action && event.action !== action) return false;
      return true;
    });
    return events;
  },
  update: async ({ id, name, ...rest }) => ({ id, name, ...rest })
};
