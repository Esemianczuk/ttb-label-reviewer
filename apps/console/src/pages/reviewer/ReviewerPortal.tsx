import { Col, Row } from "antd";
import { ReviewQueue } from "../../components/review/ReviewQueue";
import { ReviewWorkbench } from "../../components/review/ReviewWorkbench";

export function ReviewerPortal() {
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24}>
        <ReviewWorkbench />
      </Col>
      <Col xs={24}>
        <ReviewQueue />
      </Col>
    </Row>
  );
}
