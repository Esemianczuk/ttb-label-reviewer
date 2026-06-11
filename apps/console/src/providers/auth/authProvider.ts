import type { AuthProvider } from "@refinedev/core";
import type { UserRole } from "../../domain/application/types";

export const ROLE_STORAGE_KEY = "ttb-console-role";

export type ConsoleIdentity = {
  id: string;
  name: string;
  role: UserRole;
  email: string;
};

const identities: Record<UserRole, ConsoleIdentity> = {
  applicant: {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Demo Applicant",
    role: "applicant",
    email: "applicant@example.local"
  },
  reviewer: {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Demo Reviewer",
    role: "reviewer",
    email: "reviewer@example.local"
  },
  admin: {
    id: "00000000-0000-0000-0000-000000000003",
    name: "Demo Admin",
    role: "admin",
    email: "admin@example.local"
  }
};

export function getStoredRole(): UserRole {
  const stored = window.localStorage.getItem(ROLE_STORAGE_KEY);
  if (stored === "applicant" || stored === "reviewer" || stored === "admin") return stored;
  return "reviewer";
}

export function setStoredRole(role: UserRole): void {
  window.localStorage.setItem(ROLE_STORAGE_KEY, role);
}

export function getConsoleIdentity(): ConsoleIdentity {
  return identities[getStoredRole()];
}

export const authProvider: AuthProvider = {
  login: async ({ role }: { role?: UserRole }) => {
    setStoredRole(role || "reviewer");
    return { success: true };
  },
  logout: async () => ({ success: true }),
  check: async () => ({ authenticated: true }),
  onError: async () => ({}),
  getIdentity: async () => getConsoleIdentity(),
  getPermissions: async () => ({ role: getStoredRole() })
};
