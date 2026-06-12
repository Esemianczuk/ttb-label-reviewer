import type { ApplicationStatus } from "../../domain/application/types";
import { GovProcessTracker } from "./GovProcessTracker";

export function ApplicationProgressTracker({ status }: { status: ApplicationStatus }) {
  return <GovProcessTracker status={status} />;
}
