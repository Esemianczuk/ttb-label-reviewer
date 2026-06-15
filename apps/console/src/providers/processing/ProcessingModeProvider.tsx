import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
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
  provider: ConsoleProviderDefinition;
  dataProvider: DataProvider;
  liveProvider: LiveProvider;
  health: BackendHealth;
  backendUrl: string;
  backendRequired: boolean;
  backendUnavailable: boolean;
};

const ProcessingModeContext = createContext<ProcessingModeContextValue | null>(null);

export function ProcessingModeProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(subscribeToSnapshot, getSnapshot, getSnapshot);
  const mode = snapshot.processingMode;
  const provider = providerForMode(mode);
  const healthState = useBackendHealth({ enabled: true });

  useEffect(() => {
    if (healthState.health.status === "online" && mode !== "backend") {
      setProcessingMode("backend");
    }
    if (healthState.health.status === "offline" && mode === "backend") {
      setProcessingMode("browser");
    }
  }, [healthState.health.status, mode]);

  const value = useMemo<ProcessingModeContextValue>(
    () => ({
      mode,
      provider,
      dataProvider: provider.dataProvider,
      liveProvider: provider.liveProvider,
      health: healthState.health,
      backendUrl: healthState.backendUrl,
      backendRequired: provider.requiresBackend,
      backendUnavailable: mode === "backend" && healthState.health.status === "offline"
    }),
    [healthState, mode, provider]
  );

  return <ProcessingModeContext.Provider value={value}>{children}</ProcessingModeContext.Provider>;
}


export function useProcessingModeContext(): ProcessingModeContextValue {
  const value = useContext(ProcessingModeContext);
  if (!value) throw new Error("useProcessingModeContext must be used inside ProcessingModeProvider.");
  return value;
}
