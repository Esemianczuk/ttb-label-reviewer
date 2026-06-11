import { CheckCircleOutlined, FileImageOutlined, FormOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Button, Card, Col, Row, Space, Steps, Typography } from "antd";
import { Link } from "react-router";

export function ApplicantOnboarding() {
  return (
    <Space orientation="vertical" className="full-width" size={16}>
      <Card
        size="small"
        title="Applicant Onboarding"
        extra={
          <Button type="primary">
            <Link to="/applicant/applications/new">Start Application</Link>
          </Button>
        }
      >
        <Steps
          current={0}
          responsive
          items={[
            { title: "Product", icon: <SafetyCertificateOutlined /> },
            { title: "Fields", icon: <FormOutlined /> },
            { title: "Images", icon: <FileImageOutlined /> },
            { title: "Pre-check", icon: <CheckCircleOutlined /> }
          ]}
        />
      </Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card size="small" title="Application Values">
            <Typography.Paragraph>
              Brand, class/type, alcohol content, net contents, responsible party, origin, and government-warning applicability are checked against image evidence.
            </Typography.Paragraph>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" title="Label Images">
            <Typography.Paragraph>
              Upload front, back, neck, carton, other, or COLA-sheet images. Demo uploads accept JPG, JPEG, PNG, and WebP; official COLAs Online label images are JPG, JPEG, or PNG.
            </Typography.Paragraph>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" title="Corrections">
            <Typography.Paragraph>
              Correction requests stay attached to the packet timeline, and resubmission preserves prior review context.
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
