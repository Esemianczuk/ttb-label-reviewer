import { ReviewQueue } from "../../components/review/ReviewQueue";
import { GovPageShell } from "../../layouts/GovPageShell";

export function ReviewQueuePage() {
  return (
    <GovPageShell
      title="Review Queue"
      eyebrow="Review"
      description="Triage submitted packets, inspect the key application facts, and open the workbench when a packet is ready for review."
    >
      <ReviewQueue title="Submitted applications" />
    </GovPageShell>
  );
}
