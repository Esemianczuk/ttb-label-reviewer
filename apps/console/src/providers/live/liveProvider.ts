import type { LiveEvent, LiveProvider } from "@refinedev/core";
import { subscribeToSnapshot } from "../data/browserStore";

const callbacks = new Map<string, (event: LiveEvent) => void>();

export const liveProvider: LiveProvider = {
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
