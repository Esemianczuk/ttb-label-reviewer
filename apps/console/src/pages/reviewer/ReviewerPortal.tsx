import {
  CheckCircleOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  WarningOutlined
} from "@ant-design/icons";
import { Col, Row, Space } from "antd";
import { useNavigate } from "react-router";
import { GovMetricCard } from "../../components/common/GovMetricCard";
import { ReviewIssueSummary, ReviewWorkbench } from "../../components/review/ReviewWorkbench";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { GovPageShell } from "../../layouts/GovPageShell";
import { lowConfidenceFields, unresolvedCriticalFailures } from "./reviewerUtils";

export function ReviewerPortal() {
  const { snapshot } = useConsoleStore();
  const navigate = useNavigate();
  const critical = snapshot.applications.filter((application) => unresolvedCriticalFailures(application).length > 0);
  const corrections = snapshot.applications.filter((application) => application.status === "NEEDS_CORRECTION");
  const fastPass = snapshot.applications.filter((application) => application.review?.status === "PASS");
  const lowConfidence = snapshot.applications.filter((application) => lowConfidenceFields(application).length > 0);
  const newSubmissions = snapshot.applications.filter((application) => ["SUBMITTED", "RESUBMITTED"].includes(application.status));
  const readyForDecision = snapshot.applications.filter((application) => application.review && !unresolvedCriticalFailures(application).length);
  const activeApplication = snapshot.applications.find((application) => application.id === snapshot.activeApplicationId) || snapshot.applications[0];
  const openQueueFilter = (filter: string) => navigate(`/reviewer/queue?filter=${filter}&from=dashboard`);

  return (
    <GovPageShell
      title="Reviewer Dashboard"
      eyebrow="Review"
    >
      <Space orientation="vertical" className="full-width" size={16}>
        <ReviewIssueSummary application={activeApplication} />
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} xl={6}>
            <GovMetricCard title="New submissions" value={newSubmissions.length} icon={<FileSearchOutlined />} onClick={() => openQueueFilter("new_submissions")} />
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <GovMetricCard title="Critical mismatches" value={critical.length} icon={<WarningOutlined />} danger={critical.length > 0} onClick={() => openQueueFilter("critical_fail")} />
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <GovMetricCard title="Needs review" value={lowConfidence.length + corrections.length} icon={<FolderOpenOutlined />} onClick={() => openQueueFilter("needs_review")} />
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <GovMetricCard title="Ready for decision" value={readyForDecision.length || fastPass.length} icon={<CheckCircleOutlined />} onClick={() => openQueueFilter("ready_for_decision")} />
          </Col>
        </Row>

        <ReviewWorkbench />
      </Space>
    </GovPageShell>
  );
}
