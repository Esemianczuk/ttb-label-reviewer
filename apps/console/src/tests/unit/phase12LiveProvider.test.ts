import { describe, expect, it } from "vitest";
import type { LiveEvent } from "@refinedev/core";
import { browserDataProvider } from "../../providers/data/browserDataProvider";
import { resetSnapshot } from "../../providers/data/browserStore";
import { browserLiveProvider } from "../../providers/live/liveProvider";

describe("phase 12 live provider", () => {
  it("emits browser snapshot changes on resource channels", async () => {
    resetSnapshot();
    const events: LiveEvent[] = [];
    const subscription = browserLiveProvider.subscribe({
      channel: "resources/applications",
      types: ["*"],
      callback: (event) => events.push(event)
    });

    await browserDataProvider.custom?.({
      url: "applications/draft",
      method: "post",
      payload: {
        expectedFields: {
          productType: "wine",
          brandName: "Live Phase Twelve",
          classType: "Red Wine",
          alcoholContent: "13% alc/vol",
          netContents: "750 mL",
          governmentWarningRequired: true,
          applicationId: "LIVE-12"
        },
        images: [
          {
            id: "live-12-image",
            role: "front",
            name: "front.png",
            url: "data:image/png;base64,AA==",
            mimeType: "image/png",
            source: "upload"
          }
        ]
      }
    });

    browserLiveProvider.unsubscribe(subscription);

    expect(events.some((event) => event.channel === "resources/applications" && event.payload.event === "application.created")).toBe(true);
  });

  it("filters browser live events by channel", async () => {
    resetSnapshot();
    const events: LiveEvent[] = [];
    const subscription = browserLiveProvider.subscribe({
      channel: "resources/workers",
      types: ["*"],
      callback: (event) => events.push(event)
    });

    await browserDataProvider.custom?.({
      url: "applications/draft",
      method: "post",
      payload: {
        expectedFields: {
          productType: "distilled_spirits",
          brandName: "Filtered Live Event",
          classType: "Vodka",
          alcoholContent: "40% alc/vol",
          netContents: "750 mL",
          governmentWarningRequired: true,
          applicationId: "LIVE-12-FILTER"
        },
        images: []
      }
    });

    browserLiveProvider.unsubscribe(subscription);

    expect(events).toHaveLength(0);
  });
});
