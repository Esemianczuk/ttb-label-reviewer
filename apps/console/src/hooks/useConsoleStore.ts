import { useMemo, useSyncExternalStore } from "react";
import type { ReviewApplication } from "../domain/application/types";
import { getSnapshot, subscribeToSnapshot } from "../providers/data/browserStore";

export function useConsoleStore() {
  const snapshot = useSyncExternalStore(subscribeToSnapshot, getSnapshot, getSnapshot);
  const activeApplication = useMemo<ReviewApplication | undefined>(
    () => snapshot.applications.find((application) => application.id === snapshot.activeApplicationId) || snapshot.applications[0],
    [snapshot.activeApplicationId, snapshot.applications]
  );
  const activeIndex = useMemo(
    () => snapshot.applications.findIndex((application) => application.id === activeApplication?.id),
    [activeApplication?.id, snapshot.applications]
  );

  return {
    snapshot,
    activeApplication,
    activeIndex,
    hasPrevious: activeIndex > 0,
    hasNext: activeIndex >= 0 && activeIndex < snapshot.applications.length - 1
  };
}
