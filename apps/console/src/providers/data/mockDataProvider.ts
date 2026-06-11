import type { DataProvider } from "@refinedev/core";
import { createDemoSnapshot } from "../../domain/application/demoData";
import type { ConsoleSnapshot } from "../../domain/application/types";
import { snapshotResourceData } from "./snapshotResources";

let mockSnapshot: ConsoleSnapshot = createDemoSnapshot();

export function resetMockDataProvider(): ConsoleSnapshot {
  mockSnapshot = createDemoSnapshot();
  return mockSnapshot;
}

export const mockDataProvider: DataProvider = {
  getList: async ({ resource }) => {
    const data = snapshotResourceData(resource, mockSnapshot);
    return { data, total: data.length };
  },
  getOne: async ({ resource, id }) => {
    const data = snapshotResourceData(resource, mockSnapshot).find((item) => String(item.id) === String(id));
    if (!data) throw new Error(`Mock ${resource} record ${id} was not found.`);
    return { data };
  },
  create: async ({ resource, variables }) => {
    const data = { id: `${resource}-${Date.now()}`, ...(variables as Record<string, unknown>) };
    return { data: data as any };
  },
  update: async ({ id, variables }) => ({ data: { id, ...(variables as Record<string, unknown>) } as any }),
  deleteOne: async ({ id }) => ({ data: { id } as any }),
  getApiUrl: () => "mock://ttb-console",
  custom: async ({ url }) => {
    if (String(url || "").replace(/^\/+/, "") === "demo/reset") {
      return { data: resetMockDataProvider() as any };
    }
    return { data: {} };
  }
};
