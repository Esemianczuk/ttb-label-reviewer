import { SendOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, List, Space, Typography, message } from "antd";
import { Link, useParams } from "react-router";
import { ApplicationProgressTracker } from "../../components/application/ApplicationProgressTracker";
import { StatusTag } from "../../components/common/StatusTag";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { respondToApplicantCorrection } from "../../providers/data/browserStore";

export function CorrectionResponsePage() {
  const { applicationId } = useParams();
  const { snapshot } = useConsoleStore();
  const [form] = Form.useForm<{ response: string }>();
  const [messageApi, contextHolder] = message.useMessage();
  const application = snapshot.applications.find((candidate) => candidate.id === applicationId);

  if (!application) return <Card size="small">Application not found.</Card>;

  const correctionFields = application.metadata.correctionFields || [];

  return (
    <Space orientation="vertical" className="full-width" size={16}>
      {contextHolder}
      <Card size="small" title={`${application.title} Corrections`} extra={<StatusTag status={application.status} />}>
        <ApplicationProgressTracker status={application.status} />
      </Card>
      {application.status === "NEEDS_CORRECTION" ? (
        <Alert
          type="warning"
          showIcon
          message="Correction requested"
          description={application.metadata.correctionMessage || "Reviewer requested applicant updates before continuing review."}
        />
      ) : (
        <Alert type="info" showIcon message="No open correction request" />
      )}
      {correctionFields.length ? (
        <Card size="small" title="Requested Fields">
          <List dataSource={correctionFields} renderItem={(field) => <List.Item>{field}</List.Item>} />
        </Card>
      ) : null}
      <Card size="small" title="Response">
        <Form
          form={form}
          layout="vertical"
          initialValues={{ response: application.metadata.correctionResponse || "" }}
          onFinish={(values) => {
            respondToApplicantCorrection({ applicationId: application.id, response: values.response });
            messageApi.success("Correction response submitted.");
          }}
        >
          <Form.Item label="Response to reviewer" name="response" rules={[{ required: true }]}>
            <Input.TextArea rows={6} />
          </Form.Item>
          <Space wrap>
            <Button type="primary" htmlType="submit" icon={<SendOutlined />} disabled={application.status !== "NEEDS_CORRECTION"}>
              Resubmit
            </Button>
            <Button>
              <Link to={`/applicant/applications/${application.id}`}>Application Detail</Link>
            </Button>
            <Typography.Text type="secondary">Current response: {application.metadata.correctionResponse || "None"}</Typography.Text>
          </Space>
        </Form>
      </Card>
    </Space>
  );
}
