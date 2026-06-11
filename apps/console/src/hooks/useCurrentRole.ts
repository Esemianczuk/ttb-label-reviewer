import { useEffect, useState } from "react";
import type { UserRole } from "../domain/application/types";
import { getConsoleIdentity, getStoredRole, setStoredRole, type ConsoleIdentity } from "../providers/auth/authProvider";

export function useCurrentRole() {
  const [role, setRoleState] = useState<UserRole>(() => getStoredRole());
  const [identity, setIdentity] = useState<ConsoleIdentity>(() => getConsoleIdentity());

  const setRole = (nextRole: UserRole) => {
    setStoredRole(nextRole);
    setRoleState(nextRole);
    setIdentity(getConsoleIdentity());
  };

  useEffect(() => {
    const onStorage = () => {
      setRoleState(getStoredRole());
      setIdentity(getConsoleIdentity());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { role, identity, setRole };
}
