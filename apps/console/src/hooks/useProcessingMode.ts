import { useProcessingModeContext } from "../providers/processing/ProcessingModeProvider";

export function useProcessingMode() {
  const {
    mode,
    provider,
    health,
    backendUrl,
    backendUnavailable
  } = useProcessingModeContext();
  return {
    mode,
    provider,
    health,
    backendUrl,
    backendUnavailable
  };
}
