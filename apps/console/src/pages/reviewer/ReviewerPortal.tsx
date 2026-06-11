import {
  AppstoreOutlined,
  CheckCircleOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  WarningOutlined
} from "@ant-design/icons";
import { Button, Card, Col, Row, Space, Statistic, Typography } from "antd";
import { Link } from "react-router";
import { ReviewQueue } from "../../components/review/ReviewQueue";
import { ReviewWorkbench } from "../../components/review/ReviewWorkbench";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { lowConfidenceFields, unresolvedCriticalFailures } from "./reviewerUtils";

export function ReviewerPortal() {
  const { snapshot } = useConsoleStore();
  const critical = snapshot.applications.filter((application) => unresolvedCriticalFailures(application).length > 0);
  const corrections = snapshot.applications.filter((application) => application.status === "NEEDS_CORRECTION");
  const fastPass = snapshot.applications.filter((application) => application.review?.status === "PASS");
  const lowConfidence = snapshot.applications.filter((application) => lowConfidenceFields(application).length > 0);

  return (
    <Space orientation="vertical" className="full-width" size={16}>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="Critical Failures" value={critical.length} prefix={<WarningOutlined />} valueStyle={{ color: critical.length ? "#b42318" : undefined }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="Needs Correction" value={corrections.length} prefix={<FileSearchOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="Fast Passes" value={fastPass.length} prefix={<CheckCircleOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="Low Confidence" value={lowConfidence.length} prefix={<FolderOpenOutlined />} />
          </Card>
        </Col>
      </Row>

      <div className="section-toolbar">
        <Typography.Title level={2}>Reviewer Dashboard</Typography.Title>
        <Space wrap>
          <Button icon={<FileSearchOutlined />}>
            <Link to="/reviewer/queue">Queue</Link>
          </Button>
          <Button icon={<AppstoreOutlined />}>
            <Link to="/reviewer/batches">Batches</Link>
          </Button>
          <Button icon={<FolderOpenOutlined />}>
            <Link to="/reviewer/reports">Reports</Link>
          </Button>
        </Space>
      </div>

      <ReviewWorkbench />

      <ReviewQueue title="Queue Preview" compact />
    </Space>
  );
}
