import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExpandOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  UndoOutlined
} from "@ant-design/icons";
import {
  Button,
  Card,
  Checkbox,
  Col,
  Input,
  Row,
  Segmented,
  Space,
  Table,
  Tooltip,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { EvidenceCrop, FieldStatus, LabelImage, ProcessingMode, ReviewApplication, ReviewEvidence, ReviewField, ReviewResult } from "../../domain/application/types";
import { cropBoxForImage, estimatedCropForField } from "../../domain/application/evidenceCrops";
import { createReviewForApplication } from "../../domain/application/demoData";
import type { BrowserReviewProgressEvent } from "../../domain/application/browserOcrReview";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import {
  acceptAutoReview,
  autoReviewApplicationWithBrowserOcr,
  finalizeReviewerDecision,
  queueApplication,
  reopenReviewerDecision,
  setActiveApplication,
  updateFieldDecision,
  updateReviewNotes
} from "../../providers/data/browserStore";
import { GovProcessTracker } from "../application/GovProcessTracker";
import { FloatingImageViewer, ImageWorkbench, type ImageProcessingOverlayState } from "../common/ImageWorkbench";
import { PdfExportButton } from "../common/PdfExportButton";
import { StatusTag } from "../common/StatusTag";
import { GovAlert } from "../common/GovAlert";
import { GovFieldResultBadge } from "./GovFieldResultBadge";
import { criticalFields, effectiveFieldStatus } from "../../pages/reviewer/reviewerUtils";
import { applicationNumberFor } from "../../domain/application/applicationNumber";

const REVIEW_ISSUE_FOCUS_EVENT = "ttb-review-issue-focus";
const CLOSED_REVIEW_STATUSES = ["APPROVED", "CONDITIONALLY_APPROVED", "REJECTED"];
const AUTO_RUN_ON_NEXT_KEY = "ttb-reviewer-auto-run-on-next";
const PENDING_AUTO_REVIEW_KEY = "ttb-reviewer-pending-auto-review";

type ReviewProcessingProgress = {
  applicationId: string;
  message: string;
  percent: number;
  stage: BrowserReviewProgressEvent["stage"];
  mode: ProcessingMode;
  imageId?: string;
  imageName?: string;
  fieldLabel?: string;
  confidence?: number;
  crop?: EvidenceCrop;
  workerLabel?: string;
};

function isApplicationClosed(application: ReviewApplication): boolean {
  return CLOSED_REVIEW_STATUSES.includes(application.status);
}

function browserStorage(): Storage | undefined {
  return typeof window !== "undefined" ? window.localStorage : undefined;
}

export function readReviewerAutoRunPreference(storage = browserStorage()): boolean {
  try {
    const stored = storage?.getItem(AUTO_RUN_ON_NEXT_KEY);
    if (stored === "0" || stored === "false") return false;
    return true;
  } catch {
    return true;
  }
}

export function writeReviewerAutoRunPreference(enabled: boolean, storage = browserStorage()): void {
  try {
    if (enabled) storage?.setItem(AUTO_RUN_ON_NEXT_KEY, "1");
    else storage?.setItem(AUTO_RUN_ON_NEXT_KEY, "0");
  } catch {
    // Storage can be unavailable in privacy modes; the in-memory checkbox state still works.
  }
}

export function readPendingAutoReviewApplicationId(storage = browserStorage()): string | null {
  try {
    return storage?.getItem(PENDING_AUTO_REVIEW_KEY) || null;
  } catch {
    return null;
  }
}

export function writePendingAutoReviewApplicationId(applicationId: string | null, storage = browserStorage()): void {
  try {
    if (applicationId) storage?.setItem(PENDING_AUTO_REVIEW_KEY, applicationId);
    else storage?.removeItem(PENDING_AUTO_REVIEW_KEY);
  } catch {
    // Best-effort navigation handoff only; direct current-page runs still work.
  }
}

async function waitForProgressPaint(): Promise<void> {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

async function waitForReviewAnimation(ms: number): Promise<void> {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

function progressFromEvent(applicationId: string, mode: ProcessingMode, event: BrowserReviewProgressEvent): ReviewProcessingProgress {
  return {
    applicationId,
    message: event.message,
    percent: event.percent,
    stage: event.stage,
    mode,
    imageId: event.imageId,
    imageName: event.imageName,
    fieldLabel: event.fieldLabel || event.field?.label,
    confidence: event.confidence ?? event.field?.confidence,
    crop: event.crop || event.field?.evidence[0]?.crop,
    workerLabel: event.workerLabel || workerLabelForMode(mode)
  };
}

function mergeLiveReviewField(fields: ReviewField[], nextField: ReviewField): ReviewField[] {
  const existingIndex = fields.findIndex((field) => field.id === nextField.id);
  if (existingIndex >= 0) {
    return fields.map((field, index) => (index === existingIndex ? nextField : field));
  }
  return [...fields, nextField];
}

function imageProcessingStateFromProgress(progress: ReviewProcessingProgress): ImageProcessingOverlayState {
  return {
    active: progress.stage !== "complete",
    stage: progress.stage,
    message: progress.message,
    percent: progress.percent,
    mode: progress.mode,
    fieldLabel: progress.fieldLabel,
    confidence: progress.confidence,
    crop: progress.crop,
    workerLabel: progress.workerLabel
  };
}

function workerLabelForMode(mode: ProcessingMode): string {
  if (mode === "cluster") return "Distributed OCR workers";
  if (mode === "backend") return "FastAPI coordinator";
  return "Browser OCR worker pool";
}

async function playCoordinatorReviewProgress(
  application: ReviewApplication,
  review: ReviewResult,
  mode: ProcessingMode,
  emit: (event: BrowserReviewProgressEvent) => Promise<void>
): Promise<void> {
  const workerLabel = workerLabelForMode(mode);
  const firstImage = application.images[0];
  await emit({
    stage: "queued",
    message: mode === "cluster" ? "Queued distributed OCR job and selecting workers." : "Queued backend OCR job with the coordinator.",
    percent: 10,
    imageId: firstImage?.id,
    imageName: firstImage?.name,
    workerLabel
  });
  await waitForReviewAnimation(110);
  await emit({
    stage: "segmenting",
    message: mode === "cluster" ? "Parallel workers are segmenting label regions." : "Backend service is segmenting label regions.",
    percent: 24,
    imageId: firstImage?.id,
    imageName: firstImage?.name,
    workerLabel
  });
  await waitForReviewAnimation(140);
  await emit({
    stage: "ocr",
    message: mode === "cluster" ? "Worker results are returning OCR evidence." : "Backend OCR evidence returned to the console.",
    percent: 42,
    imageId: firstImage?.id,
    imageName: firstImage?.name,
    workerLabel
  });
  await waitForReviewAnimation(120);
  await emit({
    stage: "validating",
    message: "Deterministic validators are classifying expected vs extracted evidence.",
    percent: 52,
    imageId: firstImage?.id,
    imageName: firstImage?.name,
    workerLabel: "Validation engine"
  });
  for (const [index, field] of review.fields.entries()) {
    await emit({
      stage: "field",
      message: `${field.label}: ${fieldPassFailStatus(field).toLowerCase()} at ${Math.round(field.confidence * 100)}% confidence.`,
      percent: Math.min(94, 56 + Math.round(((index + 1) / Math.max(review.fields.length, 1)) * 36)),
      imageId: field.evidence[0]?.sourceImageId || firstImage?.id,
      imageName: application.images.find((image) => image.id === field.evidence[0]?.sourceImageId)?.name || firstImage?.name,
      field,
      fieldLabel: field.label,
      confidence: field.confidence,
      crop: field.evidence[0]?.crop,
      workerLabel: mode === "cluster" ? `Parallel lane ${(index % 3) + 1}` : "Coordinator validator"
    });
    await waitForReviewAnimation(mode === "cluster" ? 70 : 85);
  }
}

export function ReviewWorkbench({ applicationId, titleLevel = 2 }: { applicationId?: string; titleLevel?: 1 | 2 }) {
  const { snapshot, activeApplication } = useConsoleStore();
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedImageId, setSelectedImageId] = useState<string | undefined>();
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewProgress, setReviewProgress] = useState<ReviewProcessingProgress | null>(null);
  const [liveReviewFields, setLiveReviewFields] = useState<Record<string, ReviewField[]>>({});
  const [autoRunOnNext, setAutoRunOnNext] = useState(() => readReviewerAutoRunPreference());
  const autoReviewAttemptedIdsRef = useRef(new Set<string>());
  const application = applicationId ? snapshot.applications.find((candidate) => candidate.id === applicationId) : activeApplication;
  const selectedImage = application?.images.find((image) => image.id === selectedImageId) || application?.images[0];
  const reviewableApplications = useMemo(
    () => snapshot.applications.filter((candidate) => !["WITHDRAWN", "ARCHIVED"].includes(candidate.status)),
    [snapshot.applications]
  );
  const reviewableIndex = application ? reviewableApplications.findIndex((candidate) => candidate.id === application.id) : -1;
  const hasFilteredPrevious = reviewableIndex > 0;
  const hasFilteredNext = reviewableIndex >= 0 && reviewableIndex < reviewableApplications.length - 1;

  useEffect(() => {
    if (applicationId && applicationId !== snapshot.activeApplicationId) setActiveApplication(applicationId);
  }, [applicationId, snapshot.activeApplicationId]);

  useEffect(() => {
    if (application?.images[0] && !application.images.some((image) => image.id === selectedImageId)) {
      setSelectedImageId(application.images[0].id);
    }
  }, [application?.id, application?.images, selectedImageId]);

  const runAutoReview = useCallback(
    async (targetApplicationId: string, showSuccess = true) => {
      const targetApplication = snapshot.applications.find((candidate) => candidate.id === targetApplicationId);
      if (!targetApplication) return;
      const processingMode = snapshot.processingMode;
      const emitEvent = async (event: BrowserReviewProgressEvent) => {
        const progress = progressFromEvent(targetApplicationId, processingMode, event);
        setReviewProgress(progress);
        if (event.imageId) setSelectedImageId(event.imageId);
        if (event.field) {
          setLiveReviewFields((current) => ({
            ...current,
            [targetApplicationId]: mergeLiveReviewField(current[targetApplicationId] || [], event.field as ReviewField)
          }));
        }
        await waitForProgressPaint();
      };
      setReviewingId(targetApplicationId);
      setLiveReviewFields((current) => ({ ...current, [targetApplicationId]: [] }));
      setReviewProgress({
        applicationId: targetApplicationId,
        message: "Preparing evidence analysis.",
        percent: 6,
        stage: "queued",
        mode: processingMode,
        imageId: targetApplication.images[0]?.id,
        imageName: targetApplication.images[0]?.name,
        workerLabel: workerLabelForMode(processingMode)
      });
      try {
        await waitForProgressPaint();
        let progressStep = 0;
        if (processingMode !== "browser") {
          const previewReview = createReviewForApplication(targetApplication, processingMode);
          await playCoordinatorReviewProgress(targetApplication, previewReview, processingMode, emitEvent);
          await autoReviewApplicationWithBrowserOcr(targetApplicationId, processingMode);
        } else {
          await autoReviewApplicationWithBrowserOcr(targetApplicationId, processingMode, {
          onProgress: (message) => {
            progressStep += 1;
            setReviewProgress({
              applicationId: targetApplicationId,
              message,
                percent: Math.min(88, 18 + progressStep * 10),
                stage: "ocr",
                mode: processingMode,
                imageId: targetApplication.images[0]?.id,
                imageName: targetApplication.images[0]?.name,
                workerLabel: workerLabelForMode(processingMode)
            });
            },
            onProgressEvent: emitEvent
          });
        }
        setReviewProgress({
          applicationId: targetApplicationId,
          message: "Evidence review complete.",
          percent: 100,
          stage: "complete",
          mode: processingMode,
          imageId: targetApplication.images[0]?.id,
          imageName: targetApplication.images[0]?.name,
          workerLabel: "Review package ready"
        });
        if (showSuccess) messageApi.success("Auto review completed.");
      } catch (error) {
        messageApi.error(error instanceof Error ? error.message : "Auto review failed.");
      } finally {
        setReviewingId(null);
        window.setTimeout(() => {
          setReviewProgress((current) => (current?.applicationId === targetApplicationId ? null : current));
          setLiveReviewFields((current) => {
            const next = { ...current };
            delete next[targetApplicationId];
            return next;
          });
        }, 1200);
      }
    },
    [messageApi, snapshot.applications, snapshot.processingMode]
  );

  useEffect(() => {
    if (!application || !autoRunOnNext) return;
    const pendingApplicationId = readPendingAutoReviewApplicationId();
    const isPendingTarget = pendingApplicationId === application.id;
    if (pendingApplicationId && !isPendingTarget) return;
    if (isPendingTarget) writePendingAutoReviewApplicationId(null);
    if (application.review || isApplicationClosed(application)) return;
    if (reviewingId === application.id || autoReviewAttemptedIdsRef.current.has(application.id)) return;
    autoReviewAttemptedIdsRef.current.add(application.id);
    queueApplication(application.id);
    void runAutoReview(application.id, false);
  }, [application?.id, application?.review, application?.status, autoRunOnNext, reviewingId, runAutoReview]);

  const goToOffset = (offset: number, options: { autoReview?: boolean } = {}) => {
    if (reviewableIndex < 0) return;
    const next = reviewableApplications[reviewableIndex + offset];
    if (!next) return;
    const shouldAutoReview = options.autoReview ?? (offset > 0 && autoRunOnNext);
    if (!isApplicationClosed(next)) queueApplication(next.id);
    writePendingAutoReviewApplicationId(shouldAutoReview && !next.review && !isApplicationClosed(next) ? next.id : null);
    setActiveApplication(next.id);
    navigate(`/reviewer/applications/${next.id}`);
  };

  const handleAutoRunChange = (checked: boolean) => {
    writeReviewerAutoRunPreference(checked);
    setAutoRunOnNext(checked);
    if (!checked) {
      writePendingAutoReviewApplicationId(null);
      return;
    }
    if (!application || application.review || isApplicationClosed(application)) return;
    writePendingAutoReviewApplicationId(null);
    autoReviewAttemptedIdsRef.current.add(application.id);
    queueApplication(application.id);
    void runAutoReview(application.id);
  };

  const runSafely = (action: () => void, success?: string) => {
    try {
      action();
      if (success) messageApi.success(success);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Reviewer action failed.");
    }
  };

  useKeyboardShortcuts(
    useMemo(
      () => ({
        n: () => goToOffset(1),
        p: () => goToOffset(-1),
        r: () => application && !autoRunOnNext && !isApplicationClosed(application) && void runAutoReview(application.id),
        a: () => application && runSafely(() => acceptAutoReview(application.id), "Automated result accepted.")
      }),
      [reviewableIndex, application?.id, reviewableApplications, snapshot.processingMode, autoRunOnNext]
    )
  );

  if (!application) return <GovAlert type="warning">No applications are loaded.</GovAlert>;
  const activeReviewProgress = reviewProgress?.applicationId === application.id ? reviewProgress : null;
  const activeLiveFields = liveReviewFields[application.id] || [];
  const imageProcessing = activeReviewProgress ? imageProcessingStateFromProgress(activeReviewProgress) : null;

  return (
    <div className="workbench-grid">
      {contextHolder}
      <section className="workbench-main">
        <ReviewHeader
          application={application}
          titleLevel={titleLevel}
          onNext={() => goToOffset(1)}
          onPrevious={() => goToOffset(-1)}
          hasNext={hasFilteredNext}
          hasPrevious={hasFilteredPrevious}
          reviewing={reviewingId === application.id}
          onRun={() => void runAutoReview(application.id)}
          autoRunOnNext={autoRunOnNext}
          onAutoRunChange={handleAutoRunChange}
        />
        {activeReviewProgress ? <ReviewProgressBanner progress={activeReviewProgress} /> : null}
        <Row gutter={[16, 16]} className="reviewer-evidence-layout">
          <Col xs={24}>
            <EvidenceViewer application={application} selectedImage={selectedImage} onSelectImage={setSelectedImageId} processing={imageProcessing} />
          </Col>
        </Row>
        <FieldReviewTable application={application} liveFields={activeLiveFields} processing={Boolean(activeReviewProgress && activeReviewProgress.stage !== "complete")} />
        <FinalDispositionBar
          application={application}
          onAction={runSafely}
          onNext={() => goToOffset(1)}
          hasNext={hasFilteredNext}
        />
      </section>
    </div>
  );
}

function ReviewHeader({
  application,
  titleLevel,
  hasNext,
  hasPrevious,
  onNext,
  onPrevious,
  onRun,
  reviewing,
  autoRunOnNext,
  onAutoRunChange
}: {
  application: ReviewApplication;
  titleLevel: 1 | 2;
  hasNext: boolean;
  hasPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onRun: () => void;
  reviewing: boolean;
  autoRunOnNext: boolean;
  onAutoRunChange: (checked: boolean) => void;
}) {
  const closed = isApplicationClosed(application);
  return (
    <Card className="workbench-header" size="small">
      <div className="stack-tight">
        <Space wrap className="reviewer-title-row">
          <Typography.Title level={titleLevel}>{application.title}</Typography.Title>
          <StatusTag status={application.status} />
        </Space>
        <Typography.Text strong>Application # {applicationNumberFor(application)}</Typography.Text>
        <Typography.Text type="secondary">{application.metadata.description}</Typography.Text>
        <GovProcessTracker
          status={application.status}
          flow="reviewer"
          evidenceChecked={Boolean(application.review)}
          decisionOpen={Boolean(application.metadata.reviewerDecisionReopened)}
        />
      </div>
      <Space wrap>
        <Button icon={<ArrowLeftOutlined />} disabled={!hasPrevious} onClick={onPrevious}>
          Previous
        </Button>
        <Button type="primary" icon={<ArrowRightOutlined />} disabled={!hasNext} onClick={onNext}>
          Next Application
        </Button>
        <Checkbox checked={autoRunOnNext} onChange={(event) => onAutoRunChange(event.target.checked)}>
          Auto-run automation
        </Checkbox>
        {!autoRunOnNext && !closed ? (
          <Button icon={<PlayCircleOutlined />} loading={reviewing} onClick={onRun}>
            {application.review ? "Rerun automated review" : "Run automated review"}
          </Button>
        ) : null}
        <RawOcrButton application={application} />
        <PdfExportButton application={application} pageName="Reviewer Workbench" />
      </Space>
    </Card>
  );
}

function RawOcrButton({ application }: { application: ReviewApplication }) {
  const [open, setOpen] = useState(false);
  const content = rawOcrTextForApplication(application);
  const hasReview = Boolean(application.review);
  return (
    <>
      <Button icon={<FileTextOutlined />} disabled={!hasReview} onClick={() => setOpen(true)}>
        Raw OCR
      </Button>
      <FloatingReviewTextViewer title="Drag to move OCR text" open={open} onClose={() => setOpen(false)}>
        <pre className="floating-text-pre">{content}</pre>
      </FloatingReviewTextViewer>
    </>
  );
}

function ReviewProgressBanner({ progress }: { progress: ReviewProcessingProgress }) {
  return (
    <GovAlert type="info" title="Review in progress">
      <Space wrap className="review-progress-strip" size={10}>
        <span>{humanProgressStage(progress.stage)}</span>
        <Typography.Text>{progress.message}</Typography.Text>
        <Typography.Text type="secondary">{Math.round(progress.percent)}%</Typography.Text>
      </Space>
    </GovAlert>
  );
}

function humanProgressStage(stage: ReviewProcessingProgress["stage"]): string {
  if (stage === "segmenting") return "Segmenting";
  if (stage === "ocr") return "Reading";
  if (stage === "validating" || stage === "field") return "Classifying";
  if (stage === "complete") return "Complete";
  return "Queued";
}

function FloatingReviewTextViewer({
  title,
  open,
  onClose,
  children
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const [position, setPosition] = useState(defaultTextViewerPosition);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const clearDrag = () => {
    dragRef.current = null;
  };

  useEffect(() => {
    if (!open) return;
    setPosition(defaultTextViewerPosition());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="floating-viewer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="floating-text-viewer" role="dialog" aria-label={title} aria-modal="true" style={{ left: position.x, top: position.y }}>
        <div
          className="floating-viewer-header"
          onPointerDown={(event) => {
            if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
            dragRef.current = { startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y };
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!dragRef.current) return;
            setPosition({
              x: Math.max(12, dragRef.current.originX + event.clientX - dragRef.current.startX),
              y: Math.max(12, dragRef.current.originY + event.clientY - dragRef.current.startY)
            });
          }}
          onPointerUp={clearDrag}
          onPointerCancel={clearDrag}
          onLostPointerCapture={clearDrag}
        >
          <strong>{title}</strong>
          <span />
          <Tooltip title="Close">
            <Button aria-label={`Close ${title}`} className="floating-viewer-close" icon={<CloseCircleOutlined />} onClick={onClose} />
          </Tooltip>
        </div>
        <div className="floating-text-body">{children}</div>
      </section>
    </div>
  );
}

function defaultTextViewerPosition() {
  if (typeof window === "undefined") return { x: 320, y: 72 };
  const width = Math.min(920, window.innerWidth - 56);
  return {
    x: Math.max(24, Math.round((window.innerWidth - width) / 2)),
    y: 72
  };
}

function rawOcrTextForApplication(application: ReviewApplication): string {
  const review = application.review as (ReviewApplication["review"] & { rawText?: string }) | undefined;
  const rawText = String(review?.rawOcrText || review?.rawText || "").trim();
  if (rawText) return rawText;
  if (review?.fields.length) {
    return [
      "Raw OCR text was not retained for this review. Showing extracted field evidence instead.",
      "",
      ...review.fields.map((field) => `${field.label}: ${field.extracted || field.reason}`)
    ].join("\n");
  }
  return "Run automated review to generate OCR text for this application.";
}

export function ReviewIssueSummary({ application }: { application?: ReviewApplication }) {
  const issues = useMemo(() => reviewIssuesForApplication(application), [application?.id, application?.review]);
  if (!application?.review || !issues.length) return null;
  const primary = issues[0];
  return (
    <>
      <GovAlert
        type={primary.tone}
        title="Review required"
        action={
          issues.length > 1 ? (
            <Button onClick={() => focusReviewIssues(issues)}>
              View all {issues.length} issues
            </Button>
          ) : undefined
        }
      >
        <Space orientation="vertical" size={4}>
          <Typography.Text>{primary.message}</Typography.Text>
          {issues.length > 1 ? <Typography.Text type="secondary">{issues.length - 1} additional issue{issues.length === 2 ? "" : "s"} need attention.</Typography.Text> : null}
        </Space>
      </GovAlert>
    </>
  );
}

type ReviewIssue = {
  key: string;
  fieldLabel: string;
  statusLabel: string;
  message: string;
  detail?: string;
  tone: "warning" | "error";
  score: number;
};

function reviewIssuesForApplication(application?: ReviewApplication): ReviewIssue[] {
  if (!application?.review) return [];
  return reviewIssuesForFields(application.review.fields);
}

function reviewIssuesForFields(fields: ReviewField[]): ReviewIssue[] {
  return fields
    .flatMap((field) => {
      const status = effectiveFieldStatus(field);
      const failed = fieldPassFailStatus(field) === "FAIL";
      const lowConfidence = field.confidence < 0.78;
      if (!failed && !lowConfidence) return [];
      const critical = field.severity === "critical";
      const tone: ReviewIssue["tone"] = critical || ["FAIL", "NOT_FOUND"].includes(status) ? "error" : "warning";
      return [
        {
          key: field.id,
          fieldLabel: field.label,
          statusLabel: failed ? "Fail" : "Low confidence",
          message: issueMessageForField(field),
          detail: field.reviewerReason || field.reason,
          tone,
          score: (field.fieldKey === "governmentWarning" ? 200 : 0) + (critical ? 100 : 0) + (failed ? 20 : 0) + (lowConfidence ? 5 : 0)
        }
      ];
    })
    .sort((left, right) => right.score - left.score || left.fieldLabel.localeCompare(right.fieldLabel));
}

function focusReviewIssues(issues: ReviewIssue[]) {
  if (typeof window === "undefined") return;
  const fieldIds = issues.map((issue) => issue.key);
  window.dispatchEvent(new CustomEvent(REVIEW_ISSUE_FOCUS_EVENT, { detail: { fieldIds } }));
  window.requestAnimationFrame(() => {
    const target = findVisibleReviewField(fieldIds) || document.querySelector<HTMLElement>(".review-issue-remediation-region");
    target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  });
}

function findVisibleReviewField(fieldIds: string[]) {
  for (const fieldId of fieldIds) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-review-field-id="${cssEscape(fieldId)}"]`));
    const visible = candidates.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (visible) return visible;
  }
  return null;
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/"/g, '\\"');
}

function issueMessageForField(field: ReviewField): string {
  if (field.fieldKey === "governmentWarning") {
    return "The government warning is missing or incomplete in the extracted label evidence.";
  }
  if (fieldPassFailStatus(field) === "FAIL") {
    return `${field.label} does not match the extracted label evidence.`;
  }
  return `${field.label} was extracted with low confidence and should be checked.`;
}

function EvidenceViewer({
  application,
  selectedImage,
  onSelectImage,
  processing
}: {
  application: ReviewApplication;
  selectedImage?: LabelImage;
  onSelectImage: (imageId: string) => void;
  processing?: ImageProcessingOverlayState | null;
}) {
  return (
    <Space orientation="vertical" className="full-width" size={12}>
      {application.images.length > 1 ? (
        <Card title="Label Images" size="small">
          <Space wrap className="evidence-thumb-strip">
            {application.images.map((image) => (
              <Button
                key={image.id}
                className={selectedImage?.id === image.id ? "selected-thumb-button" : undefined}
                onClick={() => onSelectImage(image.id)}
              >
                <LabelThumb image={image} />
                {image.role.replace("_", " ")}
              </Button>
            ))}
          </Space>
        </Card>
      ) : null}
      <ImageWorkbench image={selectedImage} processing={processing} />
    </Space>
  );
}

function LabelThumb({ image }: { image: LabelImage }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="image-thumb image-thumb-empty">No image</span>;
  return <img src={image.url} alt={`${image.name} thumbnail`} width={34} height={34} className="image-thumb" onError={() => setFailed(true)} />;
}

export function FieldReviewTable({
  application,
  liveFields = [],
  processing = false
}: {
  application: ReviewApplication;
  liveFields?: ReviewField[];
  processing?: boolean;
}) {
  const [messageApi, contextHolder] = message.useMessage();
  const [focusedIssueIds, setFocusedIssueIds] = useState<Set<string>>(new Set());
  const displayFields = liveFields.length ? liveFields : application.review?.fields || [];
  const issueIds = useMemo(
    () => new Set((application.review ? reviewIssuesForApplication(application) : reviewIssuesForFields(displayFields)).map((issue) => issue.key)),
    [application?.id, application?.review, displayFields]
  );
  const locked = isApplicationClosed(application) || processing || !application.review;
  useEffect(() => {
    const onFocusIssues = (event: Event) => {
      const fieldIds = ((event as CustomEvent<{ fieldIds?: string[] }>).detail?.fieldIds || []).filter(Boolean);
      if (!fieldIds.length) return;
      setFocusedIssueIds(new Set(fieldIds));
      window.setTimeout(() => setFocusedIssueIds(new Set()), 2600);
    };
    window.addEventListener(REVIEW_ISSUE_FOCUS_EVENT, onFocusIssues);
    return () => window.removeEventListener(REVIEW_ISSUE_FOCUS_EVENT, onFocusIssues);
  }, []);

  if (!application.review && !displayFields.length) {
    return (
      <Card
        title={
          <Space wrap>
            <span>Expected vs Extracted Field Comparison</span>
            {processing ? <span className="live-review-pill">Live analysis</span> : null}
          </Space>
        }
        size="small"
        className={`gov-evidence-panel ${processing ? "live-review-panel" : ""}`}
      >
        {processing ? <div className="live-review-status" aria-live="polite">Waiting for the first classified field...</div> : null}
        <GovAlert type="info" title={processing ? "Automated review running" : "Automated review required"}>
          {processing ? "Classified evidence will appear here as each field is resolved." : "Run automated review to compare expected application values with extracted label evidence."}
        </GovAlert>
      </Card>
    );
  }

  const columns: ColumnsType<ReviewField> = [
    {
      title: "Field",
      dataIndex: "label",
      width: 130,
      render: (_, field) => (
        <Space orientation="vertical" size={4}>
          <strong>{field.label}</strong>
          <Typography.Text type="secondary">{field.severity}</Typography.Text>
        </Space>
      )
    },
    {
      title: "Expected",
      dataIndex: "expected",
      width: 180,
      render: (_, field) => <FieldValueBlock label="Application value" value={field.expected} />
    },
    {
      title: "Extracted",
      dataIndex: "extracted",
      width: 185,
      render: (_, field) => (
        <FieldValueBlock
          label="Label evidence"
          value={field.extracted}
          subtext={`${Math.round(field.confidence * 100)}% confidence`}
          muted={machineEvidenceOverridden(field)}
        />
      )
    },
    {
      title: "Evidence",
      width: 220,
      render: (_, field) => <EvidenceReference application={application} field={field} muted={machineEvidenceOverridden(field)} />
    },
    {
      title: "Result",
      width: 165,
      render: (_, field) => <FieldPassFailDecision application={application} field={field} locked={locked} onError={(error) => messageApi.error(error)} />
    },
    {
      title: "Notes",
      width: 190,
      render: (_, field) => <FieldReasonInput application={application} field={field} locked={locked} onError={(error) => messageApi.error(error)} />
    }
  ];

  return (
    <Card
      title={
        <Space wrap>
          <span>Expected vs Extracted Field Comparison</span>
          {processing ? <span className="live-review-pill">Live analysis</span> : null}
        </Space>
      }
      size="small"
      className={`gov-evidence-panel review-issue-remediation-region ${locked ? "review-closed-panel" : ""} ${processing ? "live-review-panel" : ""}`}
    >
      {contextHolder}
      {processing ? (
        <div className="live-review-status" aria-live="polite">
          {displayFields.length ? `${displayFields.length} field${displayFields.length === 1 ? "" : "s"} classified so far.` : "Waiting for the first classified field..."}
        </div>
      ) : null}
      <Table
        rowKey="id"
        columns={columns}
        dataSource={displayFields}
        pagination={false}
        size="middle"
        scroll={{ x: 1120 }}
        rowClassName={(field) => `${reviewFieldClassName(field, issueIds, focusedIssueIds)} ${processing ? "review-field-live" : ""}`}
        onRow={(field) => ({ "aria-label": `${field.label} field review`, "data-review-field-id": field.id })}
        className="reviewer-field-table"
      />
      <FieldReviewMobileList application={application} fields={displayFields} issueIds={issueIds} focusedIssueIds={focusedIssueIds} locked={locked} onError={(error) => messageApi.error(error)} />
    </Card>
  );
}

function reviewFieldClassName(field: ReviewField, issueIds: Set<string>, focusedIssueIds: Set<string>) {
  const classes = [];
  if (issueIds.has(field.id)) classes.push("review-field-needs-attention");
  if (focusedIssueIds.has(field.id)) classes.push("review-field-focus-highlight");
  return classes.join(" ");
}

function FieldReviewMobileList({
  application,
  fields,
  issueIds,
  focusedIssueIds,
  locked,
  onError
}: {
  application: ReviewApplication;
  fields: ReviewField[];
  issueIds: Set<string>;
  focusedIssueIds: Set<string>;
  locked: boolean;
  onError: (error: string) => void;
}) {
  if (!fields.length) return null;
  return (
    <div className="reviewer-field-mobile-list">
      {fields.map((field) => (
        <section
          className={`reviewer-field-card ${reviewFieldClassName(field, issueIds, focusedIssueIds)}`}
          aria-label={`${field.label} field review`}
          data-review-field-id={field.id}
          key={field.id}
        >
          <div className="reviewer-field-card-header">
            <Space orientation="vertical" size={2}>
              <Typography.Text strong>{field.label}</Typography.Text>
              <Typography.Text type="secondary">{field.severity}</Typography.Text>
            </Space>
          </div>
          <div className="reviewer-field-card-grid">
            <FieldValueBlock label="Expected application value" value={field.expected} />
            <FieldValueBlock label="Extracted label evidence" value={field.extracted} subtext={`${Math.round(field.confidence * 100)}% confidence`} muted={machineEvidenceOverridden(field)} />
            <EvidenceReference application={application} field={field} muted={machineEvidenceOverridden(field)} />
          </div>
          <div className="field-reviewer-row">
            <Typography.Text strong>Result</Typography.Text>
            <FieldPassFailDecision application={application} field={field} locked={locked} onError={onError} />
          </div>
          <FieldReasonInput application={application} field={field} locked={locked} onError={onError} />
        </section>
      ))}
    </div>
  );
}

function FieldPassFailDecision({
  application,
  field,
  locked,
  onError
}: {
  application: ReviewApplication;
  field: ReviewField;
  locked: boolean;
  onError: (error: string) => void;
}) {
  const current = fieldPassFailStatus(field);
  return (
    <div className={`field-pass-fail-control field-pass-fail-control-${current.toLowerCase()}`}>
      <GovFieldResultBadge status={current} />
      <Segmented
        aria-label={`${field.label} pass fail decision`}
        value={current}
        disabled={locked}
        onChange={(value) => {
          try {
            updateFieldDecision({
              applicationId: application.id,
              fieldId: field.id,
              status: value as FieldStatus,
              reason: field.reviewerReason
            });
          } catch (error) {
            onError(error instanceof Error ? error.message : "Could not update field decision.");
          }
        }}
        options={[
          { label: "Pass", value: "PASS" },
          { label: "Fail", value: "FAIL" }
        ]}
      />
    </div>
  );
}

function fieldPassFailStatus(field: ReviewField): "PASS" | "FAIL" {
  const status = effectiveFieldStatus(field);
  return status === "PASS" || status === "NOT_APPLICABLE" || status === "PASS_WITH_WARNINGS" ? "PASS" : "FAIL";
}

function passFailFromStatus(status: FieldStatus | undefined): "PASS" | "FAIL" {
  return status === "PASS" || status === "NOT_APPLICABLE" || status === "PASS_WITH_WARNINGS" ? "PASS" : "FAIL";
}

function machineEvidenceOverridden(field: ReviewField): boolean {
  return Boolean(field.reviewerStatus) && passFailFromStatus(field.reviewerStatus) !== passFailFromStatus(field.status);
}

function FieldReasonInput({
  application,
  field,
  locked,
  onError
}: {
  application: ReviewApplication;
  field: ReviewField;
  locked: boolean;
  onError: (error: string) => void;
}) {
  return (
    <Input.TextArea
      aria-label={`${field.label} reasoning`}
      value={field.reviewerReason ?? ""}
      placeholder={field.reason}
      autoSize={{ minRows: 2, maxRows: 4 }}
      disabled={locked}
      onChange={(event) => {
        try {
          updateFieldDecision({
            applicationId: application.id,
            fieldId: field.id,
            reason: event.target.value
          });
        } catch (error) {
          onError(error instanceof Error ? error.message : "Could not update field note.");
        }
      }}
    />
  );
}

function FieldValueBlock({ label, value, subtext, muted }: { label: string; value: string; subtext?: string; muted?: boolean }) {
  return (
    <div className={`field-value-block ${muted ? "machine-evidence-muted" : ""}`}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text>{value || "Not supplied"}</Typography.Text>
      {subtext ? <Typography.Text type="secondary">{subtext}</Typography.Text> : null}
    </div>
  );
}

function EvidenceReference({ application, field, muted }: { application: ReviewApplication; field: ReviewField; muted?: boolean }) {
  const evidence = field.evidence[0];
  const image = application.images.find((candidate) => candidate.id === evidence?.sourceImageId) || application.images[0];
  return (
    <div className={`field-evidence-reference ${muted ? "machine-evidence-muted" : ""}`}>
      {image ? <EvidenceThumb image={image} images={application.images} field={field} evidence={evidence} /> : <div className="field-evidence-thumb field-evidence-thumb-empty">No image</div>}
    </div>
  );
}

function EvidenceThumb({ image, images, field, evidence }: { image: LabelImage; images: LabelImage[]; field: ReviewField; evidence?: ReviewEvidence }) {
  const [failed, setFailed] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedImageId, setSelectedImageId] = useState(image.id);
  const isFailedField = fieldPassFailStatus(field) === "FAIL";
  const crop = evidence?.crop || estimatedCropForField(field.fieldKey);
  const cropImage = useEvidenceCropImage(image, crop, `${field.label} evidence`);
  const fullImage = images.find((candidate) => candidate.id === selectedImageId) || image;
  useEffect(() => {
    setFailed(false);
    setSelectedImageId(image.id);
  }, [image.id, image.url]);

  if (failed) {
    return (
      <div className="field-evidence-thumb field-evidence-thumb-empty">
        Image unavailable
      </div>
    );
  }
  const viewerImage: LabelImage = cropImage
    ? {
        ...image,
        id: `${image.id}-${field.id}-crop`,
        name: `${field.label} OCR evidence crop`,
        url: cropImage.url,
        width: cropImage.width,
        height: cropImage.height
      }
    : image;
  if (isFailedField) {
    return (
      <>
        <Tooltip title="This field failed or needs reviewer judgment. Expand the full label image to verify whether the evidence is present.">
          <button
            type="button"
            className="field-evidence-thumb-button field-evidence-full-image-button"
            aria-label={`Review full label image for ${field.label}`}
            onClick={() => setViewerOpen(true)}
          >
            <img className="field-evidence-thumb" src={image.url} alt={`${image.name} full label evidence`} onError={() => setFailed(true)} draggable={false} />
            <span className="field-evidence-crop-label">Full image</span>
            <span className="field-evidence-hover-hint">
              <ExpandOutlined /> Review full image
            </span>
          </button>
        </Tooltip>
        <FloatingImageViewer
          image={fullImage}
          imageOptions={images}
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          onImageChange={(nextImage) => setSelectedImageId(nextImage.id)}
        />
      </>
    );
  }
  return (
    <>
      <Tooltip title={evidence?.excerpt || "Click evidence crop to expand. Drag inside the viewer to pan; use the mouse wheel to zoom."}>
        <button type="button" className="field-evidence-thumb-button" aria-label={`Expand evidence image ${image.name}`} onClick={() => setViewerOpen(true)}>
          <img className="field-evidence-thumb" src={cropImage?.url || image.url} alt={`${field.label} OCR evidence crop`} onError={() => setFailed(true)} draggable={false} />
          <span className="field-evidence-crop-label">{crop.source === "ocr" ? "OCR crop" : "Evidence crop"}</span>
          <span className="field-evidence-hover-hint">
            <ExpandOutlined /> Expand
          </span>
        </button>
      </Tooltip>
      <FloatingImageViewer image={viewerImage} open={viewerOpen} onClose={() => setViewerOpen(false)} />
    </>
  );
}

function useEvidenceCropImage(image: LabelImage, crop: EvidenceCrop, label: string) {
  const [cropImage, setCropImage] = useState<{ url: string; width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    const load = async () => {
      try {
        const loaded = await loadHtmlImage(image.url);
        const cropBox = cropBoxForImage(crop, loaded.naturalWidth, loaded.naturalHeight);
        const scale = Math.min(1, 420 / cropBox.width);
        const width = Math.max(1, Math.round(cropBox.width * scale));
        const height = Math.max(1, Math.round(cropBox.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas unavailable.");
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(loaded, cropBox.x, cropBox.y, cropBox.width, cropBox.height, 0, 0, width, height);
        objectUrl = canvas.toDataURL("image/jpeg", 0.88);
        if (!cancelled) setCropImage({ url: objectUrl, width, height });
      } catch {
        if (!cancelled) setCropImage(null);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (objectUrl.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
    };
  }, [crop.height, crop.source, crop.unit, crop.width, crop.x, crop.y, image.url, label]);

  return cropImage;
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (!url.startsWith("blob:") && !url.startsWith("data:")) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function FinalDispositionBar({
  application,
  onAction,
  onNext,
  hasNext
}: {
  application: ReviewApplication;
  onAction: (action: () => void, success?: string) => void;
  onNext: () => void;
  hasNext: boolean;
}) {
  const [note, setNote] = useState(application.metadata.reviewerDecisionNote || application.review?.reviewerNotes || "");
  const unresolvedCriticalFields = criticalFields(application);
  const hasAutomatedReview = Boolean(application.review);
  const closed = isApplicationClosed(application);
  const approvalBlockReason = !hasAutomatedReview
    ? "Run automated review before passing this application."
    : unresolvedCriticalFields.length
      ? "Resolve failed critical fields before passing this application."
      : "";

  useEffect(() => {
    setNote(application.metadata.reviewerDecisionNote || application.review?.reviewerNotes || "");
  }, [application.id, application.metadata.reviewerDecisionNote, application.review?.reviewerNotes]);

  const saveNotes = (nextNote = note) => {
    if (!application.review || closed) return;
    updateReviewNotes({ applicationId: application.id, reviewerNotes: nextNote });
  };

  const passApplication = () => {
    onAction(() => finalizeReviewerDecision({ applicationId: application.id, decision: "approve", note }), "Application passed.");
  };

  const failApplication = () => {
    const failNote = note.trim() || "Reviewer marked this application failed after evidence review.";
    onAction(() => finalizeReviewerDecision({ applicationId: application.id, decision: "reject", note: failNote }), "Application failed.");
  };

  const reopenApplication = () => {
    onAction(() => reopenReviewerDecision(application.id), "Application reopened.");
  };

  return (
    <Card size="small" className={`final-disposition-bar ${closed ? "review-closed-panel" : ""}`}>
      <div className="final-disposition-content">
        <div>
          <Typography.Title level={3}>Final reviewer decision</Typography.Title>
          <Typography.Text type="secondary">
            {closed ? "This application is closed. Reopen it before changing field decisions or reviewer notes." : "Use the table above to correct individual fields, then mark the application Pass or Fail."}
          </Typography.Text>
          {closed ? (
            <GovAlert type={application.status === "REJECTED" ? "error" : "success"} title="Application closed">
              {application.status === "REJECTED" ? "The reviewer recorded a failed final decision." : "The reviewer recorded a passing final decision."}
            </GovAlert>
          ) : approvalBlockReason ? (
            <GovAlert type="warning" title="Pass blocked">
              {approvalBlockReason}
            </GovAlert>
          ) : null}
        </div>
        <Input.TextArea
          aria-label="Reviewer decision note"
          value={note}
          rows={3}
          placeholder="Optional reviewer note. A fail reason is added automatically if left blank."
          onChange={(event) => {
            setNote(event.target.value);
            saveNotes(event.target.value);
          }}
          disabled={!hasAutomatedReview || closed}
        />
        <Space wrap className="final-disposition-actions">
          {closed ? (
            <>
              <Button type="primary" size="large" icon={<ArrowRightOutlined />} disabled={!hasNext} onClick={onNext}>
                Next Application
              </Button>
              <Button size="large" icon={<UndoOutlined />} onClick={reopenApplication}>
                Reopen
              </Button>
            </>
          ) : (
            <>
              <Button
                type="primary"
                size="large"
                icon={<CheckCircleOutlined />}
                disabled={Boolean(approvalBlockReason)}
                onClick={passApplication}
              >
                Pass application
              </Button>
              <Button danger size="large" icon={<CloseCircleOutlined />} disabled={!hasAutomatedReview} onClick={failApplication}>
                Fail application
              </Button>
            </>
          )}
          <PdfExportButton application={application} pageName="Reviewer Workbench" />
        </Space>
      </div>
    </Card>
  );
}
