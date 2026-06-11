import { useEffect, useState } from "react";
import { getBackendUrl, setBackendUrl } from "../providers/data/backendDataProvider";

export type BackendHealth = {
  status: "idle" | "checking" | "online" | "offline";
  message: string;
  backendUrl: string;
  database?: string;
  assetRoot?: string;
  staticDir?: string;
  staticReady?: boolean;
};

export function useBackendHealth({ enabled = true }: { enabled?: boolean } = {}) {
  const [backendUrlState, setBackendUrlState] = useState(() => getBackendUrl());
  const [health, setHealth] = useState<BackendHealth>({
    status: enabled ? "checking" : "idle",
    message: enabled ? "Checking backend coordinator" : "Backend not required in Browser Only mode",
    backendUrl: backendUrlState
  });

  useEffect(() => {
    if (!enabled) {
      setHealth({
        status: "idle",
        message: "Backend not required in Browser Only mode",
        backendUrl: backendUrlState
      });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setHealth({ status: "checking", message: "Checking backend coordinator", backendUrl: backendUrlState });
    const timeout = window.setTimeout(() => controller.abort(), 1500);

    fetch(`${backendUrlState.replace(/\/+$/, "")}/api/health`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!cancelled) {
          setHealth({
            status: "online",
            message: payload.ok ? "Coordinator online" : "Coordinator responded with a degraded status",
            backendUrl: backendUrlState,
            database: payload.database,
            assetRoot: payload.assetRoot,
            staticDir: payload.staticDir,
            staticReady: Boolean(payload.staticReady)
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setHealth({
            status: "offline",
            message: error?.name === "AbortError" ? "Coordinator health check timed out" : "Coordinator unavailable; browser mode remains available",
            backendUrl: backendUrlState
          });
        }
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [backendUrlState, enabled]);

  const updateBackendUrl = (url: string) => {
    const normalized = url.replace(/\/+$/, "");
    setBackendUrl(normalized);
    setBackendUrlState(normalized);
  };

  return { health, backendUrl: backendUrlState, setBackendUrl: updateBackendUrl };
}
