import { InboxOutlined, PlayCircleOutlined, SendOutlined } from "@ant-design/icons";
import { Button, Card, Col, Form, Input, Row, Select, Space, Table, Typography, Upload, message } from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import { useState } from "react";
import type { ExpectedFields, LabelImage, ReviewApplication } from "../../domain/application/types";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { addManualUpload, autoReviewApplication, setActiveApplication } from "../../providers/data/browserStore";
import { PdfExportButton } from "../../components/common/PdfExportButton";
import { StatusTag } from "../../components/common/StatusTag";

const { Dragger } = Upload;

export function ApplicantPortal() {
  const { snapshot } = useConsoleStore();
  const [messageApi, contextHolder] = message.useMessage();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [form] = Form.useForm();

  const submitApplication = async (values: ExpectedFields & { submitter?: string; notes?: string }) => {
    const file = fileList[0]?.originFileObj;
    if (!file) {
      messageApi.error("Attach one label image before submitting.");
      return;
    }
    const image: LabelImage = {
      id: `upload-${Date.now()}`,
      role: "cola_sheet",
      name: file.name,
      url: URL.createObjectURL(file),
      mimeType: file.type || "image/png",
      sizeBytes: file.size,
      source: "upload"
    };
    const expectedFields: ExpectedFields = {
      productType: values.productType,
      brandName: values.brandName,
      fancifulName: values.fancifulName,
      classType: values.classType,
      alcoholContent: values.alcoholContent,
      netContents: values.netContents,
      governmentWarningRequired: values.governmentWarningRequired,
      producerName: values.producerName,
      countryOfOrigin: values.countryOfOrigin,
      applicationId: values.applicationId,
      labelId: values.labelId || file.name
    };
    const snapshotAfterUpload = addManualUpload({ expectedFields, image, submitter: values.submitter, notes: values.notes });
    const application = snapshotAfterUpload.applications.find((candidate) => candidate.id === snapshotAfterUpload.activeApplicationId);
    if (application) autoReviewApplication(application.id, snapshot.processingMode);
    form.resetFields();
    setFileList([]);
    messageApi.success("Application created and sent to auto review.");
  };

  return (
    <div className="portal-grid">
      {contextHolder}
      <Card title="One-Image Application Intake" size="small" className="form-card">
        <Form
          form={form}
          layout="vertical"
          onFinish={submitApplication}
          initialValues={{
            productType: "distilled_spirits",
            governmentWarningRequired: true,
            submitter: "Evaluator upload"
          }}
        >
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item label="Brand name" name="brandName" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Fanciful name" name="fancifulName">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Class / type" name="classType" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Product type" name="productType">
                <Select
                  options={[
                    { value: "distilled_spirits", label: "Distilled Spirits" },
                    { value: "wine", label: "Wine" },
                    { value: "malt_beverage", label: "Malt Beverage" },
                    { value: "unknown", label: "Unknown" }
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Alcohol content" name="alcoholContent" rules={[{ required: true }]}>
                <Input placeholder="40% Alc./Vol. (80 Proof)" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Net contents" name="netContents" rules={[{ required: true }]}>
                <Input placeholder="750 mL" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Producer / importer" name="producerName">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Country of origin" name="countryOfOrigin">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="TTB application ID" name="applicationId">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Label ID" name="labelId">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Upload one image">
            <Dragger
              accept="image/*"
              maxCount={1}
              fileList={fileList}
              beforeUpload={() => false}
              onChange={({ fileList: next }) => setFileList(next.slice(-1))}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">Drop or choose one label/COLA image</p>
            </Dragger>
          </Form.Item>
          <Form.Item label="Submitter" name="submitter">
            <Input />
          </Form.Item>
          <Form.Item label="Notes" name="notes">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Space wrap>
            <Button type="primary" htmlType="submit" icon={<SendOutlined />}>
              Submit And Auto Review
            </Button>
          </Space>
        </Form>
      </Card>
      <Card title="Submitted Applications" size="small">
        <ApplicantApplicationTable applications={snapshot.applications} mode={snapshot.processingMode} />
      </Card>
    </div>
  );
}

function ApplicantApplicationTable({ applications, mode }: { applications: ReviewApplication[]; mode: "browser" | "backend" | "cluster" }) {
  return (
    <Table
      rowKey="id"
      dataSource={applications}
      pagination={{ pageSize: 7 }}
      columns={[
        {
          title: "Application",
          render: (_, application: ReviewApplication) => (
            <Space orientation="vertical" size={1}>
              <strong>{application.title}</strong>
              <Typography.Text type="secondary">{application.expectedFields.applicationId}</Typography.Text>
            </Space>
          )
        },
        {
          title: "Status",
          render: (_, application: ReviewApplication) => <StatusTag status={application.status} />
        },
        {
          title: "Actions",
          width: 270,
          render: (_, application: ReviewApplication) => (
            <Space wrap>
              <Button onClick={() => setActiveApplication(application.id)}>Open</Button>
              <Button icon={<PlayCircleOutlined />} onClick={() => autoReviewApplication(application.id, mode)}>
                Auto Review
              </Button>
              <PdfExportButton application={application} pageName="Applicant Submission" />
            </Space>
          )
        }
      ]}
    />
  );
}
