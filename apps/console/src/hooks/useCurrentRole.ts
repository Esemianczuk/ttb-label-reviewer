import { useEffect, useState } from "react";
import type { UserRole } from "../domain/application/types";
import { ROLE_CHANGE_EVENT, getConsoleIdentity, getStoredRole, setStoredRole, type ConsoleIdentity } from "../providers/auth/authProvider";

export function useCurrentRole() {
  const [role, setRoleState] = useState<UserRole>(() => getStoredRole());
  const [identity, setIdentity] = useState<ConsoleIdentity>(() => getConsoleIdentity());

  const setRole = (nextRole: UserRole) => {
    setStoredRole(nextRole);
    setRoleState(nextRole);
    setIdentity(getConsoleIdentity());
  };

  useEffect(() => {
    const syncRole = () => {
      setRoleState(getStoredRole());
      setIdentity(getConsoleIdentity());
    };
    window.addEventListener("storage", syncRole);
    window.addEventListener(ROLE_CHANGE_EVENT, syncRole);
    return () => {
      window.removeEventListener("storage", syncRole);
      window.removeEventListener(ROLE_CHANGE_EVENT, syncRole);
    };
  }, []);

  return { role, identity, setRole };
}
