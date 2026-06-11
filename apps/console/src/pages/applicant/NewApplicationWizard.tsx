import { CheckCircleOutlined, FileAddOutlined, InboxOutlined, SaveOutlined, SendOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Checkbox, Col, Form, Input, Row, Select, Space, Steps, Table, Typography, Upload, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  DEFAULT_APPLICANT_VALUES,
  IMAGE_ROLE_OPTIONS,
  type ApplicantFormValues,
  type DraftUploadImage,
  type ImageRole,
  draftImagesFromUploadFiles,
  expectedFieldsFromValues,
  imageCountLabel,
  toLabelImages,
  updateDraftImageRole
} from "./applicantUtils";
import { readinessIssues } from "./applicantUtils";
import { ApplicationProgressTracker } from "../../components/application/ApplicationProgressTracker";
import { createApplicantDraft, runApplicantPrecheck, submitApplicantApplication } from "../../providers/data/browserStore";
import { useConsoleStore } from "../../hooks/useConsoleStore";

const { Dragger } = Upload;

export function NewApplicationWizard() {
  const { snapshot } = useConsoleStore();
  const [form] = Form.useForm<ApplicantFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [current, setCurrent] = useState(0);
  const [uploads, setUploads] = useState<DraftUploadImage[]>([]);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const navigate = useNavigate();

  const persist = async (action: "draft" | "precheck" | "submit") => {
    const values = await form.validateFields();
    if (!uploads.length) {
      messageApi.error("Attach at least one label image.");
      setCurrent(2);
      return;
    }
    const images = toLabelImages(uploads);
    const snapshotAfterDraft = createApplicantDraft({
      expectedFields: expectedFieldsFromValues(values),
      images,
      submitter: values.submitter,
      notes: values.notes,
      precheckSettings: {
        runOcr: Boolean(values.runOcr),
        validateGovernmentWarning: Boolean(values.validateGovernmentWarning),
        requireAtLeastOneImage: true,
        autoSubmitWhenReady: Boolean(values.autoSubmitWhenReady)
      }
    });
    const applicationId = snapshotAfterDraft.activeApplicationId;
    if (action === "draft") {
      messageApi.success("Draft saved.");
      navigate(`/applicant/applications/${applicationId}`);
      return;
    }
    const snapshotAfterPrecheck = runApplicantPrecheck(applicationId, snapshot.processingMode);
    const application = snapshotAfterPrecheck.applications.find((candidate) => candidate.id === applicationId);
    if (action === "precheck" || application?.status !== "READY_TO_SUBMIT") {
      messageApi.success("Pre-check completed.");
      navigate(`/applicant/applications/${applicationId}/precheck`);
      return;
    }
    submitApplicantApplication(applicationId);
    messageApi.success("Application submitted.");
    navigate(`/applicant/applications/${applicationId}`);
  };

  const handleUploadChange = async (nextFiles: UploadFile[]) => {
    const next = nextFiles.slice(0, 10);
    setFileList(next);
    setUploads(await draftImagesFromUploadFiles(next, uploads));
  };

  const values = form.getFieldsValue();
  const previewApplication = {
    id: "preview",
    title: values.brandName ? `${values.brandName} application` : "Draft application",
    source: "upload" as const,
    status: "DRAFT" as const,
    expectedOutcome: "NEEDS_REVIEW" as const,
    expectedFields: expectedFieldsFromValues({ ...DEFAULT_APPLICANT_VALUES, ...values } as ApplicantFormValues),
    images: toLabelImages(uploads),
    submitter: values.submitter || "Applicant",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: { notes: values.notes }
  };
  const issues = readinessIssues(previewApplication);

  return (
    <Space orientation="vertical" className="full-width" size={16}>
      {contextHolder}
      <Card size="small" title="New Application">
        <Steps
          current={current}
          responsive
          items={[
            { title: "Product" },
            { title: "Fields" },
            { title: "Images" },
            { title: "Pre-check" },
            { title: "Readiness" }
          ]}
        />
      </Card>
      <Card size="small" className="form-card">
        <Form form={form} layout="vertical" initialValues={DEFAULT_APPLICANT_VALUES}>
          <div hidden={current !== 0}>
            <Row gutter={12}>
              <Col xs={24} md={12}>
                <Form.Item label="Product type" name="productType" rules={[{ required: true }]}>
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
                <Form.Item label="Submitter" name="submitter">
                  <Input />
                </Form.Item>
              </Col>
            </Row>
          </div>

          <div hidden={current !== 1}>
            <ApplicationFields />
          </div>

          <div hidden={current !== 2}>
            <Alert
              type="info"
              showIcon
              message="COLAs Online accepts JPG, JPEG, and PNG label images. This demo also accepts WebP for local testing."
              className="wizard-alert"
            />
            <Form.Item label="Upload label images">
              <Dragger
                accept="image/jpeg,image/png,image/webp"
                multiple
                maxCount={10}
                fileList={fileList}
                beforeUpload={() => false}
                onChange={({ fileList: next }) => void handleUploadChange(next)}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">Drop or choose up to 10 label images</p>
              </Dragger>
            </Form.Item>
            <UploadTable images={uploads} onRoleChange={(uid, role) => setUploads(updateDraftImageRole(uploads, uid, role))} />
          </div>

          <div hidden={current !== 3}>
            <Row gutter={12}>
              <Col xs={24} md={12}>
                <Form.Item name="runOcr" valuePropName="checked">
                  <Checkbox>Run OCR and evidence extraction</Checkbox>
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="validateGovernmentWarning" valuePropName="checked">
                  <Checkbox>Validate government warning segments</Checkbox>
                </Form.Item>
              </Col>
              <Col xs={24}>
                <Form.Item name="autoSubmitWhenReady" valuePropName="checked">
                  <Checkbox>Submit automatically if pre-check passes</Checkbox>
                </Form.Item>
              </Col>
            </Row>
          </div>

          <div hidden={current !== 4}>
            <Space orientation="vertical" className="full-width" size={12}>
              <Typography.Text strong>{imageCountLabel(uploads.length)}</Typography.Text>
              {issues.length ? (
                <Alert type="warning" showIcon message="Readiness checks need attention" description={issues.join(" ")} />
              ) : (
                <Alert type="success" showIcon message="Ready for pre-check or submission" />
              )}
              <ApplicationProgressTracker status="DRAFT" />
            </Space>
          </div>
        </Form>
      </Card>

      <Card size="small">
        <Space wrap>
          <Button disabled={current === 0} onClick={() => setCurrent(current - 1)}>
            Previous
          </Button>
          {current < 4 ? (
            <Button type="primary" onClick={() => setCurrent(current + 1)}>
              Next
            </Button>
          ) : null}
          <Button icon={<SaveOutlined />} onClick={() => void persist("draft")}>
            Save Draft
          </Button>
          <Button icon={<CheckCircleOutlined />} onClick={() => void persist("precheck")}>
            Run Pre-check
          </Button>
          <Button type="primary" icon={<SendOutlined />} onClick={() => void persist("submit")}>
            Submit Application
          </Button>
          <Button icon={<FileAddOutlined />} onClick={() => form.resetFields()}>
            Clear Fields
          </Button>
        </Space>
      </Card>
    </Space>
  );
}

export function ApplicationFields() {
  return (
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
      <Col xs={24}>
        <Form.Item label="Notes" name="notes">
          <Input.TextArea rows={3} />
        </Form.Item>
      </Col>
    </Row>
  );
}

function UploadTable({ images, onRoleChange }: { images: DraftUploadImage[]; onRoleChange: (uid: string, role: ImageRole) => void }) {
  const columns: ColumnsType<DraftUploadImage> = [
    { title: "Image", render: (_, image) => image.file.name },
    {
      title: "Role",
      width: 190,
      render: (_, image) => (
        <Select value={image.role} options={[...IMAGE_ROLE_OPTIONS]} onChange={(role) => onRoleChange(image.uid, role)} className="full-width" />
      )
    },
    { title: "Size", render: (_, image) => `${Math.round(image.file.size / 1024)} KB` },
    { title: "Dimensions", render: (_, image) => (image.width && image.height ? `${image.width} x ${image.height}` : "Pending") },
    {
      title: "Warnings",
      render: (_, image) => image.warnings.length ? image.warnings.join(" ") : "Ready"
    }
  ];
  return <Table rowKey="uid" dataSource={images} columns={columns} pagination={false} size="small" scroll={{ x: 840 }} />;
}
