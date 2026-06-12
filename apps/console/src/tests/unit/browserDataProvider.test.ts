import { describe, expect, it } from "vitest";
import { browserDataProvider } from "../../providers/data/browserDataProvider";
import { getSnapshot, resetSnapshot } from "../../providers/data/browserStore";

describe("browser data provider", () => {
  it("loads bundled applications from the browser snapshot", async () => {
    resetSnapshot();
    const response = await browserDataProvider.getList({ resource: "applications" });
    expect(response.total).toBeGreaterThan(3);
    expect(response.data[0].images.length).toBeGreaterThan(0);
    expect(response.data[0].source).toBe("public_cola_registry");
  });

  it("auto reviews an application and preserves the result in snapshot state", async () => {
    resetSnapshot();
    const applicationId = getSnapshot().applications[0].id;
    await browserDataProvider.custom?.({
      url: "reviews/auto",
      method: "post",
      payload: { applicationId, mode: "browser" }
    });
    const reviewed = getSnapshot().applications.find((application) => application.id === applicationId);
    expect(reviewed?.review?.fields.length).toBeGreaterThan(5);
    expect(reviewed?.status).toBe("IN_REVIEW");
  });

  it("updates field decisions as reviewer overrides", async () => {
    resetSnapshot();
    const applicationId = getSnapshot().applications[0].id;
    await browserDataProvider.custom?.({ url: "reviews/auto", method: "post", payload: { applicationId, mode: "browser" } });
    const fieldId = getSnapshot().applications[0].review?.fields[0].id;
    await browserDataProvider.custom?.({
      url: "reviews/field",
      method: "patch",
      payload: { applicationId, fieldId, status: "FAIL", reason: "Manual reviewer override." }
    });
    const field = getSnapshot().applications[0].review?.fields[0];
    expect(field?.reviewerStatus).toBe("FAIL");
    expect(getSnapshot().applications[0].status).toBe("IN_REVIEW");
  });
});
