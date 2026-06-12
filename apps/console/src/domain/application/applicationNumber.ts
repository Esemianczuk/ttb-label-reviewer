import type { AuditEvent, ConsoleSnapshot, ReviewApplication } from "./types";

const APPLICATION_NUMBER_PREFIX = "TTB";
const APPLICATION_NUMBER_YEAR = "2026";

export function applicationNumberFor(application?: ReviewApplication | null): string {
  if (!application) return "Unassigned";
  return application.metadata.applicationNumber || fallbackApplicationNumber(application.id);
}

export function assignApplicationNumbers(applications: ReviewApplication[]): ReviewApplication[] {
  const used = new Set(applications.map((application) => application.metadata.applicationNumber).filter(Boolean) as string[]);
  let nextOrdinal = nextOrdinalFromNumbers(used);
  return applications.map((application, index) => {
    if (application.metadata.applicationNumber) return application;
    const generated = nextApplicationNumber(used, nextOrdinal || index + 1);
    nextOrdinal = Math.max(nextOrdinal, parseOrdinal(generated) + 1);
    return {
      ...application,
      metadata: {
        ...application.metadata,
        applicationNumber: generated
      }
    };
  });
}

export function applicationNumberFromAudit(event: AuditEvent, applications: ReviewApplication[]): string | undefined {
  const metadataNumber = typeof event.metadata?.applicationNumber === "string" ? event.metadata.applicationNumber : undefined;
  if (metadataNumber) return metadataNumber;
  const applicationId = typeof event.metadata?.applicationId === "string" ? event.metadata.applicationId : undefined;
  if (!applicationId) return undefined;
  return applicationNumberFor(applications.find((application) => application.id === applicationId));
}

export function annotateAuditApplicationNumbers(snapshot: ConsoleSnapshot): ConsoleSnapshot {
  const applications = assignApplicationNumbers(snapshot.applications);
  const applicationById = new Map(applications.map((application) => [application.id, application]));
  return {
    ...snapshot,
    applications,
    auditEvents: snapshot.auditEvents.map((event) => {
      const applicationId = typeof event.metadata?.applicationId === "string" ? event.metadata.applicationId : undefined;
      if (!applicationId || event.metadata?.applicationNumber) return event;
      const application = applicationById.get(applicationId);
      if (!application) return event;
      return {
        ...event,
        metadata: {
          ...event.metadata,
          applicationNumber: applicationNumberFor(application)
        }
      };
    })
  };
}

export function createApplicationNumber(index: number): string {
  return `${APPLICATION_NUMBER_PREFIX}-${APPLICATION_NUMBER_YEAR}-${String(index).padStart(4, "0")}`;
}

function nextApplicationNumber(used: Set<string>, preferredOrdinal: number): string {
  let ordinal = Math.max(1, preferredOrdinal);
  let candidate = createApplicationNumber(ordinal);
  while (used.has(candidate)) {
    ordinal += 1;
    candidate = createApplicationNumber(ordinal);
  }
  used.add(candidate);
  return candidate;
}

function nextOrdinalFromNumbers(numbers: Set<string>): number {
  const ordinals = Array.from(numbers).map(parseOrdinal).filter((value) => value > 0);
  return ordinals.length ? Math.max(...ordinals) + 1 : 1;
}

function parseOrdinal(applicationNumber: string): number {
  const match = applicationNumber.match(/-(\d{4,})$/);
  return match ? Number(match[1]) : 0;
}

function fallbackApplicationNumber(id: string): string {
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `${APPLICATION_NUMBER_PREFIX}-${APPLICATION_NUMBER_YEAR}-${String(hash % 1_000_000).padStart(6, "0")}`;
}
