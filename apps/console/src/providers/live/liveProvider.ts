import type { LiveEvent, LiveProvider } from "@refinedev/core";
import { subscribeToSnapshot } from "../data/browserStore";
import { getBackendUrl, getSessionId } from "../data/backendDataProvider";

const callbacks = new Map<string, (event: LiveEvent) => void>();

export const browserLiveProvider: LiveProvider = {
  subscribe: ({ channel, callback }) => {
    const id = `${channel}-${Date.now()}-${callbacks.size}`;
    callbacks.set(id, callback);
    const unsubscribeStore = subscribeToSnapshot(() => {
      callback({
        channel,
        type: "updated",
        payload: { ids: [] },
        date: new Date()
      });
    });
    return { id, unsubscribeStore };
  },
  unsubscribe: (subscription) => {
    callbacks.delete(subscription?.id);
    subscription?.unsubscribeStore?.();
  },
  publish: (event) => {
    for (const callback of callbacks.values()) callback(event);
  }
};

export const apiLiveProvider: LiveProvider = {
  subscribe: ({ channel, callback }) => {
    const id = `${channel}-api-${Date.now()}`;
    const socket = new WebSocket(`${getBackendUrl().replace(/^http/, "ws")}/api/ws/sessions/${getSessionId()}`);
    socket.onmessage = (message) => {
      let payload: Record<string, any> = { message: message.data };
      try {
        payload = JSON.parse(String(message.data)) as Record<string, any>;
      } catch {
        // WebSocket health messages are best-effort for the console.
      }
      callback({
        channel,
        type: "updated",
        payload,
        date: new Date()
      });
    };
    socket.onerror = () => {
      callback({
        channel,
        type: "updated",
        payload: { type: "backend_live_error" },
        date: new Date()
      });
    };
    return { id, socket };
  },
  unsubscribe: (subscription) => {
    subscription?.socket?.close?.();
  },
  publish: () => undefined
};

export const liveProvider = browserLiveProvider;
