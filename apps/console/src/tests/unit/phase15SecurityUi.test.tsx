import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AppLayout } from "../../layouts/AppLayout";

vi.mock("../../hooks/useProcessingMode", () => ({
  useProcessingMode: () => ({
    mode: "backend",
    provider: { label: "FastAPI Backend" },
    health: {
      status: "online",
      message: "Coordinator online",
      backendUrl: "http://127.0.0.1:8000",
      database: "sqlite",
      assetRoot: "data/assets",
      staticDir: "apps/console/dist",
      staticReady: true,
      lanMode: true,
      warning: "LAN MODE ENABLED: coordinator APIs are reachable from the local network."
    },
    backendUrl: "http://127.0.0.1:8000",
    backendUnavailable: false
  })
}));

vi.mock("../../hooks/useCurrentRole", () => ({
  useCurrentRole: () => ({
    role: "admin",
    identity: { id: "admin-demo", email: "admin@example.local", role: "admin" },
    setRole: vi.fn()
  })
}));

describe("phase 15 security UI", () => {
  it("surfaces LAN mode as a prominent warning banner", () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>
    );

    expect(screen.getByText("LAN mode enabled")).toBeInTheDocument();
    expect(screen.getByText(/LAN MODE ENABLED/)).toBeInTheDocument();
    expect(screen.getByText(/Backend primary - LAN/)).toBeInTheDocument();
  });
});
