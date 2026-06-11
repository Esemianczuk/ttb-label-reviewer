import { useParams } from "react-router";
import { ReviewWorkbench } from "../../components/review/ReviewWorkbench";

export function ReviewWorkbenchPage() {
  const { applicationId } = useParams();
  return <ReviewWorkbench applicationId={applicationId} />;
}
