import type { DataProvider, LiveProvider } from "@refinedev/core";
import type { ProcessingMode } from "../../domain/application/types";
import { apiLiveProvider, browserLiveProvider } from "../live/liveProvider";
import { apiDataProvider } from "./backendDataProvider";
import { browserDataProvider } from "./browserDataProvider";

export type ConsoleProviderKey = "browser" | "api";

export type ConsoleProviderDefinition = {
  key: ConsoleProviderKey;
  label: string;
  dataProvider: DataProvider;
  liveProvider: LiveProvider;
  requiresBackend: boolean;
  auth: "local-demo" | "backend-demo";
};

export const providerRegistry: Record<ConsoleProviderKey, ConsoleProviderDefinition> = {
  browser: {
    key: "browser",
    label: "Browser Fallback",
    dataProvider: browserDataProvider,
    liveProvider: browserLiveProvider,
    requiresBackend: false,
    auth: "local-demo"
  },
  api: {
    key: "api",
    label: "FastAPI Backend",
    dataProvider: apiDataProvider,
    liveProvider: apiLiveProvider,
    requiresBackend: true,
    auth: "backend-demo"
  }
};

export function providerKeyForMode(mode: ProcessingMode): ConsoleProviderKey {
  return mode === "browser" ? "browser" : "api";
}

export function providerForMode(mode: ProcessingMode): ConsoleProviderDefinition {
  return providerRegistry[providerKeyForMode(mode)];
}
