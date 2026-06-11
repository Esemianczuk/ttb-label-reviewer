import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { DataProvider, LiveProvider } from "@refinedev/core";
import type { BackendHealth } from "../../hooks/useBackendHealth";
import { useBackendHealth } from "../../hooks/useBackendHealth";
import type { ProcessingMode } from "../../domain/application/types";
import { getSnapshot, setProcessingMode, subscribeToSnapshot } from "../data/browserStore";
import type { ConsoleProviderDefinition } from "../data/providerRegistry";
import { providerForMode } from "../data/providerRegistry";

type ProcessingModeContextValue = {
  mode: ProcessingMode;
  setMode: (mode: ProcessingMode) => void;
  fallbackToBrowser: () => void;
  provider: ConsoleProviderDefinition;
  dataProvider: DataProvider;
  liveProvider: LiveProvider;
  health: BackendHealth;
  backendUrl: string;
  setBackendUrl: (url: string) => void;
  backendRequired: boolean;
  backendUnavailable: boolean;
  clusterDashboardActive: boolean;
};

const ProcessingModeContext = createContext<ProcessingModeContextValue | null>(null);

export function ProcessingModeProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(subscribeToSnapshot, getSnapshot, getSnapshot);
  const mode = snapshot.processingMode;
  const provider = providerForMode(mode);
  const healthState = useBackendHealth({ enabled: provider.requiresBackend });

  const setMode = useCallback((nextMode: ProcessingMode) => {
    setProcessingMode(nextMode);
  }, []);

  const fallbackToBrowser = useCallback(() => {
    setProcessingMode("browser");
  }, []);

  const value = useMemo<ProcessingModeContextValue>(
    () => ({
      mode,
      setMode,
      fallbackToBrowser,
      provider,
      dataProvider: provider.dataProvider,
      liveProvider: provider.liveProvider,
      health: healthState.health,
      backendUrl: healthState.backendUrl,
      setBackendUrl: healthState.setBackendUrl,
      backendRequired: provider.requiresBackend,
      backendUnavailable: provider.requiresBackend && healthState.health.status === "offline",
      clusterDashboardActive: mode === "cluster"
    }),
    [fallbackToBrowser, healthState, mode, provider, setMode]
  );

  return <ProcessingModeContext.Provider value={value}>{children}</ProcessingModeContext.Provider>;
}

export function useProcessingModeContext(): ProcessingModeContextValue {
  const value = useContext(ProcessingModeContext);
  if (!value) throw new Error("useProcessingModeContext must be used inside ProcessingModeProvider.");
  return value;
}
