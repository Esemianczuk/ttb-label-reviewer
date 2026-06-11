import { useProcessingModeContext } from "../providers/processing/ProcessingModeProvider";

export function useProcessingMode() {
  const {
    mode,
    setMode,
    provider,
    health,
    backendUrl,
    setBackendUrl,
    backendUnavailable,
    fallbackToBrowser,
    clusterDashboardActive
  } = useProcessingModeContext();
  return {
    mode,
    setMode,
    provider,
    health,
    backendUrl,
    setBackendUrl,
    backendUnavailable,
    fallbackToBrowser,
    clusterDashboardActive
  };
}
