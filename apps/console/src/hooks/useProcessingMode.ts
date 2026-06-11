import type { ProcessingMode } from "../domain/application/types";
import { setProcessingMode } from "../providers/data/browserStore";
import { useConsoleStore } from "./useConsoleStore";

export function useProcessingMode() {
  const { snapshot } = useConsoleStore();
  const setMode = (mode: ProcessingMode) => setProcessingMode(mode);
  return { mode: snapshot.processingMode, setMode };
}
