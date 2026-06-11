import { Navigate } from "react-router";
import { getStoredRole } from "../../providers/auth/authProvider";

export function RoleLanding() {
  return <Navigate to={`/${getStoredRole()}`} replace />;
}
