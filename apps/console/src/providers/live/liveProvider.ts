import type { LiveEvent, LiveProvider } from "@refinedev/core";
import type { AdminJob, AuditEvent, ConsoleSnapshot, ReviewApplication, WorkerSnapshot } from "../../domain/application/types";
import { getSnapshot, subscribeToSnapshot } from "../data/browserStore";
import { getBackendUrl, getSessionId } from "../data/backendDataProvider";

type Subscription = {
  id: string;
  channel: string;
  types: string[];
  callback: (event: LiveEvent) => void;
  unsubscribeStore?: () => void;
  socket?: WebSocket;
};

const browserSubscriptions = new Map<string, Subscription>();
let previousBrowserSnapshot: ConsoleSnapshot | null = null;

export const browserLiveProvider: LiveProvider = {
  subscribe: ({ channel, types = ["*"], callback }) => {
    const id = `${channel}-browser-${Date.now()}-${browserSubscriptions.size}`;
    if (browserSubscriptions.size === 0) previousBrowserSnapshot = getSnapshot();
    const subscription: Subscription = { id, channel, types: types.map(String), callback };
    browserSubscriptions.set(id, subscription);
    subscription.unsubscribeStore = subscribeToSnapshot(() => {
      const current = getSnapshot();
      const events = browserSnapshotEvents(previousBrowserSnapshot, current);
      previousBrowserSnapshot = current;
      for (const event of events) dispatchLiveEvent(browserSubscriptions, event);
    });
    return subscription;
  },
  unsubscribe: (subscription) => {
    browserSubscriptions.delete(subscription?.id);
    subscription?.unsubscribeStore?.();
    if (browserSubscriptions.size === 0) previousBrowserSnapshot = null;
  },
  publish: (event) => {
    dispatchLiveEvent(browserSubscriptions, event);
  }
};

export const apiLiveProvider: LiveProvider = {
  subscribe: ({ channel, types = ["*"], callback }) => {
    const id = `${channel}-api-${Date.now()}`;
    const subscription: Subscription = { id, channel, types: types.map(String), callback };
    const socket = new WebSocket(`${getBackendUrl().replace(/^http/i, "ws")}/api/ws/sessions/${encodeURIComponent(getSessionId())}`);
    subscription.socket = socket;

    socket.onmessage = (message) => {
      const payload = parseSocketMessage(message.data);
      if (!payload) return;
      if (payload.type === "live_events" && Array.isArray(payload.events)) {
        for (const event of payload.events) {
          const liveEvent = socketEventToLiveEvent(event);
          if (matchesSubscription(subscription, liveEvent)) callback(liveEvent);
        }
      } else if (payload.type === "backend_live_error") {
        callback({
          channel,
          type: "updated",
          payload,
          date: new Date()
        });
      }
    };
    socket.onerror = () => {
      callback({
        channel,
        type: "updated",
        payload: { event: "backend.live.error", type: "backend_live_error" },
        date: new Date()
      });
    };
    return subscription;
  },
  unsubscribe: (subscription) => {
    subscription?.socket?.close?.();
  },
  publish: () => undefined
};

export const liveProvider = browserLiveProvider;

function parseSocketMessage(data: unknown): Record<string, any> | null {
  try {
    return JSON.parse(String(data)) as Record<string, any>;
  } catch {
    return null;
  }
}

function socketEventToLiveEvent(event: Record<string, any>): LiveEvent {
  return {
    channel: event.channel,
    type: event.type || "updated",
    payload: {
      ids: event.ids || (event.id ? [event.id] : []),
      id: event.id,
      event: event.event,
      resource: event.resource,
      record: event.record,
      before: event.before
    },
    date: event.date ? new Date(event.date) : new Date()
  };
}

function dispatchLiveEvent(subscriptions: Map<string, Subscription>, event: LiveEvent): void {
  for (const subscription of subscriptions.values()) {
    if (matchesSubscription(subscription, event)) subscription.callback(event);
  }
}

function matchesSubscription(subscription: Subscription, event: LiveEvent): boolean {
  const channelMatches = subscription.channel === event.channel || subscription.channel === "*" || event.channel === "*";
  const typeMatches = subscription.types.includes("*") || subscription.types.includes(String(event.type));
  return channelMatches && typeMatches;
}

function browserSnapshotEvents(previous: ConsoleSnapshot | null, current: ConsoleSnapshot): LiveEvent[] {
  if (!previous) return [];
  return [
    ...applicationEvents(previous.applications, current.applications),
    ...reviewEvents(previous.applications, current.applications),
    ...jobEvents(previous.jobs, current.jobs),
    ...workerEvents(previous.workers, current.workers),
    ...auditEvents(previous.auditEvents, current.auditEvents)
  ];
}

function applicationEvents(previous: ReviewApplication[], current: ReviewApplication[]): LiveEvent[] {
  return diffRecords("applications", previous, current, (before, after, created) => (created ? "application.created" : before?.status !== after.status ? "application.updated" : "application.updated"));
}

function reviewEvents(previousApplications: ReviewApplication[], currentApplications: ReviewApplication[]): LiveEvent[] {
  const previous = previousApplications.flatMap((application) => (application.review ? [{ ...application.review, id: application.review.id, applicationId: application.id }] : []));
  const current = currentApplications.flatMap((application) => (application.review ? [{ ...application.review, id: application.review.id, applicationId: application.id }] : []));
  return diffRecords("reviews", previous, current, (before, after, created) => {
    if (created) return "review.started";
    if (after.completedAt || ["PASS", "FAIL", "PASS_WITH_WARNINGS"].includes(String(after.status))) return "review.completed";
    return "review.progress";
  });
}

function jobEvents(previous: AdminJob[], current: AdminJob[]): LiveEvent[] {
  return diffRecords("jobs", previous, current, (before, after, created) => {
    if (created) return after.status === "completed" ? "job.completed" : after.status === "failed" ? "job.failed" : "job.queued";
    if (after.status === "completed") return "job.completed";
    if (after.status === "failed") return "job.failed";
    if (before?.workerId !== after.workerId && after.workerId) return "job.assigned";
    return "job.progress";
  });
}

function workerEvents(previous: WorkerSnapshot[], current: WorkerSnapshot[]): LiveEvent[] {
  return diffRecords("workers", previous, current, (before, after, created) => {
    if (created) return "worker.registered";
    if (after.status === "offline") return "worker.lost";
    return before?.lastSeenAt !== after.lastSeenAt || before?.activeJobs !== after.activeJobs ? "worker.heartbeat" : "worker.heartbeat";
  });
}

function auditEvents(previous: AuditEvent[], current: AuditEvent[]): LiveEvent[] {
  return diffRecords("auditEvents", previous, current, () => "audit.created", "created");
}

function diffRecords<T extends { id: string }>(
  resource: string,
  previous: T[],
  current: T[],
  eventName: (before: T | undefined, after: T, created: boolean) => string,
  defaultType: LiveEvent["type"] = "updated"
): LiveEvent[] {
  const previousById = new Map(previous.map((record) => [record.id, record]));
  const events: LiveEvent[] = [];
  for (const record of current) {
    const before = previousById.get(record.id);
    const created = !before;
    if (!created && JSON.stringify(before) === JSON.stringify(record)) continue;
    events.push({
      channel: `resources/${resource}`,
      type: created ? "created" : defaultType,
      payload: {
        ids: [record.id],
        id: record.id,
        event: eventName(before, record, created),
        resource,
        record,
        before
      },
      date: new Date()
    });
  }
  return events;
}
