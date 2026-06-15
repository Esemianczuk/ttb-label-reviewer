import { DeleteOutlined, FileAddOutlined, InboxOutlined, SendOutlined, StopOutlined } from "@ant-design/icons";
import { Button, Card, Col, Form, Input, Row, Select, Space, Steps, Table, Tag, Typography, Upload, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import {
  DEFAULT_APPLICANT_VALUES,
  IMAGE_ROLE_OPTIONS,
  REQUIRED_APPLICANT_FIELDS,
  applicantFieldLabel,
  type ApplicantFormValues,
  type ApplicantDataImportResult,
  type DraftUploadImage,
  type ImageRole,
  draftImagesFromUploadFiles,
  expectedFieldsFromValues,
  imageCountLabel,
  importApplicantDataFile,
  missingApplicantFields,
  toLabelImages,
  updateDraftImageRole
} from "./applicantUtils";
import { readinessIssues } from "./applicantUtils";
import { GovAlert } from "../../components/common/GovAlert";
import { fieldLabels } from "../../domain/application/demoData";
import type { LabelImage, ReviewApplication } from "../../domain/application/types";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { autosaveApplicantDraft, deleteApplicantDraft, resubmitApplicantApplication, submitApplicantApplication, withdrawApplicantApplication } from "../../providers/data/browserStore";
import { GovPageShell } from "../../layouts/GovPageShell";

const { Dragger } = Upload;
const FIELD_REVIEW_KEYS: Array<keyof ApplicantFormValues> = [
  "productType",
  "brandName",
  "fancifulName",
  "classType",
  "alcoholContent",
  "netContents",
  "governmentWarningRequired",
  "producerName",
  "countryOfOrigin",
  "applicationId",
  "labelId",
  "submitter"
];
const FIELD_REVIEW_REQUIRED_KEYS = new Set<keyof ApplicantFormValues>([...REQUIRED_APPLICANT_FIELDS, "productType"]);

export function NewApplicationWizard() {
  const [form] = Form.useForm<ApplicantFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const { applicationId } = useParams();
  const { snapshot } = useConsoleStore();
  const editingApplication = applicationId ? snapshot.applications.find((candidate) => candidate.id === applicationId) : undefined;
  const isEditing = Boolean(applicationId);
  const correctionFields = editingApplication?.metadata.correctionFields || [];
  const editingDraft = Boolean(editingApplication && isDraftStatus(editingApplication.status));
  const [current, setCurrent] = useState(0);
  const [uploads, setUploads] = useState<DraftUploadImage[]>([]);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [dataFileList, setDataFileList] = useState<UploadFile[]>([]);
  const [importResult, setImportResult] = useState<ApplicantDataImportResult | null>(null);
  const [attentionFields, setAttentionFields] = useState<Array<keyof ApplicantFormValues>>([]);
  const [saving, setSaving] = useState(false);
  const [autosavedDraftId, setAutosavedDraftId] = useState<string | undefined>(() => (editingDraft ? editingApplication?.id : undefined));
  const autosaveKeyRef = useRef("");
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const navigate = useNavigate();
  const retainedImages = isEditing && uploads.length === 0 ? editingApplication?.images || [] : [];
  const imagesForSubmission = uploads.length ? toLabelImages(uploads) : retainedImages;
  const initialValues = valuesFromApplication(editingApplication);
  const watchedValues = Form.useWatch([], form) || {};
  const values = { ...initialValues, ...watchedValues } as ApplicantFormValues;
  const previewApplication = buildPreviewApplication(values, imagesForSubmission);
  const issues = readinessIssues(previewApplication);
  const activeAttentionFields = useMemo(
    () => attentionFields.filter((field) => !String(values[field] || "").trim()),
    [attentionFields, values]
  );
  const draftAutosaveEnabled = (!isEditing || editingDraft) && !(isEditing && !editingApplication);
  const autosavePayloadKey = useMemo(
    () =>
      JSON.stringify({
        expectedFields: expectedFieldsFromValues(values),
        images: imagesForSubmission.map((image) => ({
          id: image.id,
          role: image.role,
          name: image.name,
          url: image.url,
          sizeBytes: image.sizeBytes,
          width: image.width,
          height: image.height
        })),
        submitter: values.submitter || "",
        notes: values.notes || ""
      }),
    [imagesForSubmission, values]
  );
  const title = editingApplication ? `Update ${editingApplication.expectedFields.brandName || editingApplication.title}` : "New Application";
  const description = editingApplication
    ? "Edit application fields, keep or replace the label image, add an optional note, and resubmit the packet for reviewer action."
    : "Enter application fields, upload label images, and submit the packet for reviewer action.";

  useEffect(() => {
    if (editingDraft && editingApplication?.id) setAutosavedDraftId(editingApplication.id);
  }, [editingApplication?.id, editingDraft]);

  useEffect(() => {
    if (!draftAutosaveEnabled || !hasMeaningfulDraftContent(values, imagesForSubmission)) return;
    if (autosaveKeyRef.current === autosavePayloadKey) return;
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      try {
        const snapshotAfterDraft = autosaveApplicantDraft({
          applicationId: autosavedDraftId || (editingDraft ? editingApplication?.id : undefined),
          expectedFields: expectedFieldsFromValues(values),
          images: imagesForSubmission,
          submitter: values.submitter,
          notes: values.notes
        });
        setAutosavedDraftId(snapshotAfterDraft.activeApplicationId);
        autosaveKeyRef.current = autosavePayloadKey;
      } catch (error) {
        messageApi.error(error instanceof Error ? error.message : "Draft autosave failed.");
      }
    }, 450);
    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    };
  }, [autosavePayloadKey, autosavedDraftId, draftAutosaveEnabled, editingApplication?.id, editingDraft, imagesForSubmission, messageApi, values]);

  const persist = async (action: "submit" | "resubmit" | "version") => {
    setSaving(true);
    try {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = undefined;
      }
      const values = { ...DEFAULT_APPLICANT_VALUES, ...form.getFieldsValue(true) } as ApplicantFormValues;
      const images = uploads.length ? toLabelImages(uploads) : retainedImages;
      const currentIssues = readinessIssues(buildPreviewApplication(values, images));

      if (currentIssues.length) {
        messageApi.error(`Cannot submit yet: ${currentIssues.join(" ")}`);
        const missingFields = missingApplicantFields(values);
        setAttentionFields(missingFields);
        setCurrent(missingFields.length ? 0 : 2);
        return;
      }

      if (action === "resubmit" && editingApplication && !editingDraft) {
        resubmitApplicantApplication({
          applicationId: editingApplication.id,
          expectedFields: expectedFieldsFromValues(values),
          images,
          submitter: values.submitter,
          notes: values.notes
        });
        messageApi.success("Application updated and resubmitted.");
        navigate(`/applicant/applications/${editingApplication.id}`);
        return;
      }

      const snapshotAfterDraft = autosaveApplicantDraft({
        applicationId: action === "version" ? undefined : autosavedDraftId || (editingDraft ? editingApplication?.id : undefined),
        expectedFields: expectedFieldsFromValues(values),
        images,
        submitter: values.submitter,
        notes: values.notes
      });
      const nextApplicationId = snapshotAfterDraft.activeApplicationId;
      setAutosavedDraftId(nextApplicationId);
      submitApplicantApplication(nextApplicationId);
      messageApi.success(action === "version" ? "New version submitted." : "Application submitted.");
      navigate(`/applicant/applications/${nextApplicationId}`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Application action failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleUploadChange = async (nextFiles: UploadFile[]) => {
    const next = nextFiles.slice(0, 10);
    setFileList(next);
    setUploads(await draftImagesFromUploadFiles(next, uploads));
  };

  const handleDataFileChange = async (nextFiles: UploadFile[]) => {
    const next = nextFiles.slice(-1);
    setDataFileList(next);
    const file = next[0]?.originFileObj;
    if (!file) {
      setImportResult(null);
      setAttentionFields([]);
      return;
    }
    try {
      const result = await importApplicantDataFile(file);
      const existingValues = form.getFieldsValue(true) as ApplicantFormValues;
      const mergedValues = { ...existingValues, ...result.values } as ApplicantFormValues;
      form.setFieldsValue(mergedValues);
      setImportResult(result);
      setAttentionFields(result.attentionFields);
      if (result.detectedFields.length === 0) {
        messageApi.warning("No recognizable application fields were found. You can still fill the form manually.");
      } else if (result.attentionFields.length) {
        messageApi.warning(
          `Imported ${result.detectedFields.length} fields. ${result.attentionFields.map((field) => applicantFieldLabel(field)).join(", ")} needs attention.`
        );
      } else {
        messageApi.success(`Imported ${result.detectedFields.length} application fields.`);
      }
    } catch (error) {
      setImportResult(null);
      setAttentionFields([]);
      messageApi.error(error instanceof Error ? error.message : "Application data import failed.");
    }
  };

  const clearNewDraft = () => {
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    if (autosavedDraftId) {
      try {
        deleteApplicantDraft(autosavedDraftId);
      } catch {
        // A submitted or already-removed packet should not block clearing the local form.
      }
    }
    autosaveKeyRef.current = "";
    setAutosavedDraftId(undefined);
    setUploads([]);
    setFileList([]);
    setDataFileList([]);
    setImportResult(null);
    setAttentionFields([]);
    form.resetFields();
    messageApi.success("Draft cleared.");
  };

  if (isEditing && !editingApplication) {
    return (
      <Card size="small">
        <Typography.Text>Application not found.</Typography.Text>
      </Card>
    );
  }

  return (
    <GovPageShell
      title={title}
      eyebrow="Applicant service"
      description={description}
      statusTag={<span className="gov-header-pill" style={{ color: "var(--gov-text)", background: "var(--gov-bg)" }}>Step {current + 1} of 4</span>}
    >
      <Space orientation="vertical" className="full-width" size={16}>
        {contextHolder}
        {editingApplication?.metadata.correctionMessage ? (
          <GovAlert type="warning" title="Reviewer requested updates">
            <Space orientation="vertical" size={6}>
              <Typography.Text>{editingApplication.metadata.correctionMessage}</Typography.Text>
              {correctionFields.length ? (
                <Typography.Text type="secondary">
                  Fields to check: {correctionFields.map((field) => fieldLabels[field] || readableFieldName(field)).join(", ")}
                </Typography.Text>
              ) : null}
            </Space>
          </GovAlert>
        ) : null}
        <Card size="small" title="Application steps">
          <Steps
            current={current}
            responsive
            items={[
              { title: "Product" },
              { title: "Fields" },
              { title: "Images" },
              { title: "Submit" }
            ]}
          />
        </Card>
      <Card size="small" className="form-card">
        <Form form={form} layout="vertical" initialValues={initialValues}>
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
                <Form.Item label="Applicant / Organization" name="submitter">
                  <Input />
                </Form.Item>
              </Col>
            </Row>
            {activeAttentionFields.length ? (
              <div className="wizard-alert">
                <GovAlert type="warning" title="Needs attention">
                  {activeAttentionFields.map((field) => applicantFieldLabel(field)).join(", ")} was not found in the imported application data. Fill the highlighted fields before submitting.
                </GovAlert>
              </div>
            ) : null}
            <div className="applicant-fields-section">
              <Typography.Title level={3}>Application fields</Typography.Title>
              <ApplicationFields highlightFields={correctionFields} attentionFields={activeAttentionFields} />
            </div>
            <div className="metadata-import-panel">
              <div className="metadata-import-copy">
                <Typography.Text strong>Optional auto-fill</Typography.Text>
                <Typography.Text type="secondary">
                  Drop a COLA registry JSON, XML, HTML, or text export to fill matching fields. You can ignore this and complete the form manually.
                </Typography.Text>
              </div>
              <Dragger
                accept=".json,.xml,.html,.htm,.txt,.md,application/json,application/xml,text/xml,text/html,text/plain"
                maxCount={1}
                fileList={dataFileList}
                beforeUpload={() => false}
                onChange={({ fileList: next }) => void handleDataFileChange(next)}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">Drop application data here or browse</p>
              </Dragger>
              {importResult ? (
                <div className="data-import-summary" aria-live="polite">
                  <Typography.Text strong>{importResult.sourceName}</Typography.Text>
                  <Typography.Text>
                    {importResult.detectedFields.length
                      ? `Filled ${importResult.detectedFields.map((field) => applicantFieldLabel(field)).join(", ")}.`
                      : "No recognizable fields were filled."}
                  </Typography.Text>
                  {activeAttentionFields.length ? (
                    <Typography.Text className="attention-summary">
                      Needs attention: {activeAttentionFields.map((field) => applicantFieldLabel(field)).join(", ")}.
                    </Typography.Text>
                  ) : importResult.detectedFields.length ? (
                    <Typography.Text className="ready-summary">Required fields are present.</Typography.Text>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div hidden={current !== 1}>
            <FieldReadinessReview values={values} attentionFields={activeAttentionFields} onEdit={() => setCurrent(0)} />
          </div>

          <div hidden={current !== 2}>
            <div className={`wizard-alert ${correctionFields.some((field) => ["labelImages", "governmentWarning"].includes(field)) ? "correction-section-highlight" : ""}`}>
              <GovAlert type="info" title="Upload label images">
                {editingApplication
                  ? "The current label image will be resubmitted unless you upload a replacement."
                  : "Upload separate label images, such as front, back, neck, carton, or other panels. Official COLAs Online label images are generally JPG/JPEG or PNG. This demo also accepts WebP for testing."}
              </GovAlert>
            </div>
            {editingApplication && !uploads.length ? (
              <div className="retained-image-strip" aria-label="Current label image retained for resubmission">
                {editingApplication.images.map((image) => (
                  <div className="retained-image-item" key={image.id}>
                    <img src={image.url} alt={`${image.name} current label`} />
                    <span>{image.role}</span>
                  </div>
                ))}
              </div>
            ) : null}
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
                <p className="ant-upload-text">Upload separate label images, such as front, back, neck, carton, or other panels.</p>
              </Dragger>
            </Form.Item>
            <UploadTable images={uploads} onRoleChange={(uid, role) => setUploads(updateDraftImageRole(uploads, uid, role))} />
          </div>

          <div hidden={current !== 3}>
            <Space orientation="vertical" className="full-width" size={12}>
              <Typography.Text strong>{imageCountLabel(imagesForSubmission.length)}</Typography.Text>
              {issues.length ? (
                <GovAlert type="warning" title="Action needed">{issues.join(" ")}</GovAlert>
              ) : (
                <GovAlert type="success" title="Ready to submit">
                  Required application fields and label images are present. {editingApplication && !editingDraft ? "Resubmit this packet for reviewer action." : "Submit this packet for reviewer action."}
                </GovAlert>
              )}
            </Space>
          </div>
        </Form>
      </Card>

      <Card size="small" className="wizard-action-card">
        <Space wrap>
          <Button disabled={current === 0} onClick={() => setCurrent(current - 1)}>
            Previous
          </Button>
          {current < 3 ? (
            <Button type="primary" onClick={() => setCurrent(current + 1)}>
              Next
            </Button>
          ) : null}
          {!editingApplication || editingDraft ? (
            <Typography.Text type="secondary">Draft autosaves while you work.</Typography.Text>
          ) : null}
          {current === 3 ? (
            issues.length ? (
              <Button
                type="primary"
                onClick={() => {
                  const missingFields = missingApplicantFields(values);
                  setAttentionFields(missingFields);
                  setCurrent(missingFields.length ? 0 : 2);
                }}
              >
                Fix Issues
              </Button>
            ) : editingApplication && !editingDraft ? (
              <Button type="primary" icon={<SendOutlined />} loading={saving} onClick={() => void persist("resubmit")}>
                Resubmit Updates
              </Button>
            ) : (
              <Button type="primary" icon={<SendOutlined />} loading={saving} onClick={() => void persist("submit")}>
                Submit for Review
              </Button>
            )
          ) : null}
          {editingApplication && !editingDraft ? (
            <>
              <Button icon={<FileAddOutlined />} loading={saving} onClick={() => void persist("version")}>
                Create New Version
              </Button>
              <Button
                icon={<StopOutlined />}
                danger
                onClick={() => {
                  withdrawApplicantApplication(editingApplication.id);
                  messageApi.success("Application withdrawn.");
                  navigate("/applicant");
                }}
              >
                Withdraw
              </Button>
            </>
          ) : editingDraft && editingApplication ? (
            <Button
              icon={<DeleteOutlined />}
              danger
              onClick={() => {
                if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
                deleteApplicantDraft(editingApplication.id);
                messageApi.success("Draft deleted.");
                navigate("/applicant/drafts");
              }}
            >
              Delete Draft
            </Button>
          ) : (
            <Button icon={<DeleteOutlined />} onClick={clearNewDraft}>
              Clear Draft
            </Button>
          )}
        </Space>
      </Card>
      </Space>
    </GovPageShell>
  );
}

function buildPreviewApplication(values: ApplicantFormValues, images: LabelImage[]): ReviewApplication {
  return {
    id: "preview",
    title: values.brandName ? `${values.brandName} application` : "Draft application",
    source: "upload" as const,
    status: "DRAFT" as const,
    expectedOutcome: "NEEDS_REVIEW" as const,
    expectedFields: expectedFieldsFromValues(values),
    images,
    submitter: values.submitter || "Applicant",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: { notes: values.notes }
  };
}

function valuesFromApplication(application?: ReviewApplication): Partial<ApplicantFormValues> {
  if (!application) return DEFAULT_APPLICANT_VALUES;
  return {
    ...DEFAULT_APPLICANT_VALUES,
    ...application.expectedFields,
    submitter: application.submitter,
    notes: application.metadata.notes
  };
}

function isDraftStatus(status: ReviewApplication["status"]): boolean {
  return status === "DRAFT" || status === "READY_TO_SUBMIT";
}

function hasMeaningfulDraftContent(values: ApplicantFormValues, images: LabelImage[]): boolean {
  if (images.length) return true;
  const textFields: Array<keyof ApplicantFormValues> = [
    "brandName",
    "fancifulName",
    "classType",
    "alcoholContent",
    "netContents",
    "producerName",
    "countryOfOrigin",
    "applicationId",
    "labelId",
    "submitter",
    "notes"
  ];
  if (textFields.some((field) => String(values[field] || "").trim().length > 0)) return true;
  return Boolean(values.productType && values.productType !== DEFAULT_APPLICANT_VALUES.productType);
}

function readableFieldName(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function applicantDisplayLabel(field: keyof ApplicantFormValues): string {
  const labels: Partial<Record<keyof ApplicantFormValues, string>> = {
    productType: "Product type",
    brandName: "Brand name",
    fancifulName: "Fanciful name",
    classType: "Class/type",
    alcoholContent: "Alcohol content",
    netContents: "Net contents",
    governmentWarningRequired: "Government health warning",
    producerName: "Producer / importer",
    countryOfOrigin: "Country of origin",
    applicationId: "TTB application ID",
    labelId: "Label ID",
    submitter: "Applicant / organization",
    notes: "Notes"
  };
  return labels[field] || applicantFieldLabel(field) || readableFieldName(String(field));
}

function applicantFieldValue(values: ApplicantFormValues, field: keyof ApplicantFormValues): string {
  const value = values[field];
  if (field === "governmentWarningRequired") return value === false ? "Not required" : "Required";
  if (field === "productType") return String(value || "").replaceAll("_", " ") || "Not supplied";
  return String(value || "").trim() || "Not supplied";
}

function FieldReadinessReview({
  values,
  attentionFields,
  onEdit
}: {
  values: ApplicantFormValues;
  attentionFields: Array<keyof ApplicantFormValues>;
  onEdit: () => void;
}) {
  const missingFields = new Set(missingApplicantFields(values));
  const attentionSet = new Set(attentionFields);
  return (
    <Space orientation="vertical" className="full-width" size={12}>
      <GovAlert type={missingFields.size ? "warning" : "success"} title={missingFields.size ? "Field review needed" : "Required fields complete"}>
        {missingFields.size
          ? "Some required application fields still need values. Use Edit fields to return to the full form."
          : "Required application values are ready for label-image upload."}
      </GovAlert>
      <div className="field-readiness-grid">
        {FIELD_REVIEW_KEYS.map((field) => {
          const required = FIELD_REVIEW_REQUIRED_KEYS.has(field);
          const supplied = applicantFieldValue(values, field) !== "Not supplied";
          const missing = required && !supplied;
          const attention = attentionSet.has(field);
          return (
            <div className={`field-readiness-item ${missing || attention ? "field-readiness-item-attention" : ""}`} key={String(field)}>
              <Typography.Text type="secondary">{applicantDisplayLabel(field)}</Typography.Text>
              <Typography.Text>{applicantFieldValue(values, field)}</Typography.Text>
              <Space size={6} wrap>
                {required ? <Tag color="blue">Required</Tag> : <Tag>Optional</Tag>}
                {missing ? <Tag color="orange">Missing</Tag> : supplied ? <Tag color="green">Complete</Tag> : <Tag>Not supplied</Tag>}
                {attention && !missing ? <Tag color="gold">Check imported value</Tag> : null}
              </Space>
            </div>
          );
        })}
      </div>
      <Button onClick={onEdit}>Edit fields</Button>
    </Space>
  );
}

export function ApplicationFields({ highlightFields = [], attentionFields = [] }: { highlightFields?: string[]; attentionFields?: string[] } = {}) {
  const highlighted = new Set(highlightFields);
  const needsAttention = new Set(attentionFields);
  const itemClass = (field: string) =>
    [
      highlighted.has(field) ? "correction-field-highlight" : "",
      needsAttention.has(field) ? "attention-field-highlight" : ""
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  const fieldHelp = (field: string, fallback?: ReactNode) =>
    highlighted.has(field) || needsAttention.has(field) ? (
      <Space orientation="vertical" size={0}>
        {needsAttention.has(field) ? <span className="attention-field-help">Needs attention: this field was not found in the imported application data.</span> : null}
        {highlighted.has(field) ? <span className="correction-field-help">Reviewer asked the applicant to check this value.</span> : null}
        {fallback ? <span>{fallback}</span> : null}
      </Space>
    ) : fallback;

  return (
    <Row gutter={12}>
      <Col xs={24} md={12}>
        <Form.Item label="Brand name" name="brandName" className={itemClass("brandName")} help={fieldHelp("brandName")} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      </Col>
      <Col xs={24} md={12}>
        <Form.Item label="Fanciful name" name="fancifulName" className={itemClass("fancifulName")} help={fieldHelp("fancifulName")}>
          <Input />
        </Form.Item>
      </Col>
      <Col xs={24} md={12}>
        <Form.Item
          label="Class / type"
          name="classType"
          className={itemClass("classType")}
          help={fieldHelp("classType", "Class/type is the product designation shown on the label, such as Vodka, Bourbon Whiskey, or Wine Cocktail.")}
          rules={[{ required: true }]}
        >
          <Input />
        </Form.Item>
      </Col>
      <Col xs={24} md={12}>
        <Form.Item label="Alcohol content" name="alcoholContent" className={itemClass("alcoholContent")} help={fieldHelp("alcoholContent")} rules={[{ required: true }]}>
          <Input placeholder="40% Alc./Vol. (80 Proof)" />
        </Form.Item>
      </Col>
      <Col xs={24} md={12}>
        <Form.Item label="Net contents" name="netContents" className={itemClass("netContents")} help={fieldHelp("netContents")} rules={[{ required: true }]}>
          <Input placeholder="750 mL" />
        </Form.Item>
      </Col>
      <Col xs={24} md={12}>
        <Form.Item
          label="Government health warning"
          name="governmentWarningRequired"
          className={itemClass("governmentWarningRequired")}
          help={fieldHelp("governmentWarningRequired", "Most alcohol beverage labels require the government health warning.")}
        >
          <Select
            options={[
              { value: true, label: "Required" },
              { value: false, label: "Not required" }
            ]}
          />
        </Form.Item>
      </Col>
      <Col xs={24} md={12}>
        <Form.Item label="Producer / importer" name="producerName" className={itemClass("producerName")} help={fieldHelp("producerName")}>
          <Input />
        </Form.Item>
      </Col>
      <Col xs={24} md={12}>
        <Form.Item label="Country of origin" name="countryOfOrigin" className={itemClass("countryOfOrigin")} help={fieldHelp("countryOfOrigin")}>
          <Input />
        </Form.Item>
      </Col>
      <Col xs={24} md={12}>
        <Form.Item label="TTB application ID" name="applicationId" className={itemClass("applicationId")} help={fieldHelp("applicationId")}>
          <Input />
        </Form.Item>
      </Col>
      <Col xs={24} md={12}>
        <Form.Item label="Label ID" name="labelId" className={itemClass("labelId")} help={fieldHelp("labelId")}>
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
