import { getConsoleIdentities } from "../auth/authProvider";
import type { ConsoleSnapshot, ReviewApplication } from "../../domain/application/types";
import type { ConsoleResourceName } from "../../resources";

export function snapshotResourceData(resource: string, snapshot: ConsoleSnapshot): any[] {
  switch (resource as ConsoleResourceName) {
    case "applications":
      return snapshot.applications;
    case "applicationVersions":
      return snapshot.applications.map((application) => ({
        id: `${application.id}-v1`,
        applicationId: application.id,
        versionNumber: 1,
        expectedFields: application.expectedFields,
        metadata: application.metadata,
        createdAt: application.createdAt,
        submittedAt: application.status === "DRAFT" ? null : application.updatedAt
      }));
    case "labelAssets":
      return snapshot.applications.flatMap((application) =>
        application.images.map((image) => ({
          ...image,
          applicationId: application.id,
          title: application.title
        }))
      );
    case "reviews":
      return snapshot.applications.flatMap((application) => (application.review ? [application.review] : []));
    case "reviewDecisions":
      return snapshot.applications.flatMap((application) =>
        (application.review?.fields || []).map((field) => ({
          id: field.id,
          reviewId: application.review?.id,
          applicationId: application.id,
          fieldKey: field.fieldKey,
          autoStatus: field.status,
          reviewerStatus: field.reviewerStatus,
          effectiveStatus: field.reviewerStatus || field.status,
          reviewerNote: field.reviewerReason,
          updatedAt: application.updatedAt
        }))
      );
    case "correctionRequests":
      return snapshot.auditEvents
        .filter((event) => event.action.includes("correction"))
        .map((event) => ({ ...event, status: "open" }));
    case "users":
      return getConsoleIdentities().map((identity) => ({
        id: identity.id,
        email: identity.email,
        displayName: identity.name,
        role: identity.role,
        status: "active"
      }));
    case "workers":
      return snapshot.workers;
    case "jobs":
      return snapshot.jobs;
    case "auditEvents":
      return snapshot.auditEvents;
    case "settings":
      return Object.entries(snapshot.adminSettings).map(([key, value]) => ({
        id: key,
        key,
        value,
        updatedAt: new Date().toISOString()
      }));
    case "reports":
      return snapshot.applications.filter(hasReview).map((application) => ({
        id: `report-${application.review.id}`,
        reviewId: application.review.id,
        applicationId: application.id,
        status: application.review.status,
        mode: application.review.mode,
        createdAt: application.review.completedAt || application.updatedAt
      }));
    case "fixtures":
      return snapshot.applications
        .filter((application) => application.source === "sample")
        .map((application) => ({
          id: application.metadata.fixtureId || application.id,
          applicationId: application.id,
          title: application.title,
          expectedOutcome: application.expectedOutcome,
          imageCount: application.images.length,
          packetPath: application.metadata.packetPath
        }));
    case "benchmarks":
      return snapshot.benchmarkRuns;
    default:
      return [];
  }
}

function hasReview(application: ReviewApplication): application is ReviewApplication & { review: NonNullable<ReviewApplication["review"]> } {
  return Boolean(application.review);
}
