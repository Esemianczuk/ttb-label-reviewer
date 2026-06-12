import { useParams } from "react-router";
import { ReviewWorkbench } from "../../components/review/ReviewWorkbench";

export function ReviewWorkbenchPage() {
  const { applicationId } = useParams();
  return (
    <div className="gov-page-shell">
      <ReviewWorkbench applicationId={applicationId} titleLevel={1} />
    </div>
  );
}
