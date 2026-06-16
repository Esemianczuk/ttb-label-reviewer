import {
  AppstoreOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  FilterOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined
} from "@ant-design/icons";
import { Button, Card, Checkbox, DatePicker, Empty, Input, Progress, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { CheckboxChangeEvent } from "antd/es/checkbox";
import dayjs, { type Dayjs } from "dayjs";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { StatusTag } from "../../components/common/StatusTag";
import { applicationNumberFor } from "../../domain/application/applicationNumber";
import { GovAlert } from "../../components/common/GovAlert";
import type { ProcessingMode, ReviewApplication } from "../../domain/application/types";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { getSnapshot, resetSnapshot } from "../../providers/data/browserStore";
import { runAutomatedReviewForMode } from "../../providers/data/reviewAutomation";
import { useProcessingModeContext } from "../../providers/processing/ProcessingModeProvider";
import { automatedFindingSummary, queuePriority, reviewerQueueApplications } from "./reviewerUtils";

const { RangePicker } = DatePicker;

type ProcessingFilter = "unprocessed" | "processed" | "all";

type BatchProgress = {
  index: number;
  total: number;
  applicationTitle: string;
  message: string;
  percent: number;
  processedIds: string[];
  failedIds: string[];
  activeTitles: string[];
  concurrency: number;
  mode: ProcessingMode;
  status: "running" | "paused" | "stopping" | "completed" | "stopped";
};

type BatchProgressState = {
  total: number;
  mode: ProcessingMode;
  concurrency: number;
  processedIds: string[];
  failedIds: string[];
  activeTitles: string[];
  latestTitle: string;
  message: string;
  status: BatchProgress["status"];
  inFlightWeight?: number;
};

export function ReviewerBatchesPage() {
  const { snapshot } = useConsoleStore();
  const { dataProvider, backendUnavailable } = useProcessingModeContext();
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [processingFilter, setProcessingFilter] = useState<ProcessingFilter>("unprocessed");
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchPaused, setBatchPaused] = useState(false);
  const [batchStopping, setBatchStopping] = useState(false);
  const batchControlRef = useRef({ paused: false, stop: false });

  const applications = useMemo(() => reviewerQueueApplications(snapshot.applications), [snapshot.applications]);
  const unprocessedCount = applications.filter((application) => !application.review).length;
  const filteredApplications = useMemo(
    () =>
      applications.filter((application) => {
        const processed = Boolean(application.review);
        if (processingFilter === "unprocessed" && processed) return false;
        if (processingFilter === "processed" && !processed) return false;
        if (!matchesFuzzy(applicationSearchText(application), search)) return false;
        if (!matchesFuzzy(`${application.submitter} ${application.expectedFields.producerName || ""}`, companyFilter)) return false;
        if (!matchesFuzzy(`${application.expectedFields.productType} ${application.expectedFields.classType}`, typeFilter)) return false;
        if (dateRange) {
          const created = dayjs(application.createdAt);
          if (created.isBefore(dateRange[0].startOf("day")) || created.isAfter(dateRange[1].endOf("day"))) return false;
        }
        return true;
      }),
    [applications, companyFilter, dateRange, processingFilter, search, typeFilter]
  );

  const selectableIds = filteredApplications.filter((application) => !application.review).map((application) => application.id);
  const selectedProcessableIds = selectedIds.filter((id) => selectableIds.includes(id));
  const allVisibleSelected = selectableIds.length > 0 && selectedProcessableIds.length === selectableIds.length;
  const partiallySelected = selectedProcessableIds.length > 0 && selectedProcessableIds.length < selectableIds.length;
  const filtersActive = Boolean(search || companyFilter || typeFilter || dateRange || processingFilter !== "unprocessed");

  const selectAllVisible = (event: CheckboxChangeEvent) => {
    setSelectedIds(event.target.checked ? selectableIds : []);
  };

  const resetForBatchTesting = () => {
    resetSnapshot();
    setSelectedIds([]);
    batchControlRef.current = { paused: false, stop: false };
    setBatchRunning(false);
    setBatchPaused(false);
    setBatchStopping(false);
    setBatchProgress(null);
    setProcessingFilter("unprocessed");
    setSearch("");
    setCompanyFilter("");
    setTypeFilter("");
    setDateRange(null);
    messageApi.success("Demo applications reset for batch testing.");
  };

  const clearBatchFilters = () => {
    setSelectedIds([]);
    setSearch("");
    setCompanyFilter("");
    setTypeFilter("");
    setDateRange(null);
    setProcessingFilter("unprocessed");
  };

  const runSelectedBatch = async () => {
    if (!selectedProcessableIds.length || batchRunning) return;
    const processingMode = snapshot.processingMode;
    if (processingMode !== "browser" && backendUnavailable) {
      messageApi.error("Backend processing is selected, but the FastAPI coordinator is offline. Start the backend or let the console use browser fallback.");
      return;
    }
    batchControlRef.current = { paused: false, stop: false };
    setBatchRunning(true);
    setBatchPaused(false);
    setBatchStopping(false);
    const idsToProcess = [...selectedProcessableIds];
    const concurrency = resolveBatchConcurrency(processingMode, idsToProcess.length);
    const processedIds: string[] = [];
    const failedIds: string[] = [];
    const activeTitles = new Map<number, string>();
    let nextIndex = 0;

    try {
      setBatchProgress(toBatchProgress({
        total: idsToProcess.length,
        mode: processingMode,
        concurrency,
        processedIds,
        failedIds,
        activeTitles: [],
        latestTitle: `${idsToProcess.length} selected applications`,
        message: `${modeLabel(processingMode)} parallel batch ready. Starting up to ${concurrency} application${concurrency === 1 ? "" : "s"} at a time.`,
        status: "running"
      }));

      const claimNextIndex = () => {
        if (batchControlRef.current.stop) return null;
        if (nextIndex >= idsToProcess.length) return null;
        const index = nextIndex;
        nextIndex += 1;
        return index;
      };

      const runSlot = async (slot: number) => {
        while (!batchControlRef.current.stop) {
          await waitWhileBatchPaused(idsToProcess.length, processedIds, failedIds, processingMode, concurrency, activeTitles);
          if (batchControlRef.current.stop) break;
          const index = claimNextIndex();
          if (index === null) break;
          const application = getSnapshot().applications.find((candidate) => candidate.id === idsToProcess[index]);
          if (!application) continue;
          activeTitles.set(slot, application.title);
          setBatchProgress(toBatchProgress({
            total: idsToProcess.length,
            mode: processingMode,
            concurrency,
            processedIds,
            failedIds,
            activeTitles: [...activeTitles.values()],
            latestTitle: application.title,
            message: `${modeLabel(processingMode)} review queued. Reading label evidence and matching expected fields.`,
            status: "running",
            inFlightWeight: 0.2
          }));

          try {
            await runAutomatedReviewForMode(application.id, processingMode, {
              dataProvider,
              backendUnavailable,
              onProgress: (progressMessage) => {
                setBatchProgress(toBatchProgress({
                  total: idsToProcess.length,
                  mode: processingMode,
                  concurrency,
                  processedIds,
                  failedIds,
                  activeTitles: [...activeTitles.values()],
                  latestTitle: application.title,
                  message: progressMessage,
                  status: batchControlRef.current.stop ? "stopping" : batchControlRef.current.paused ? "paused" : "running",
                  inFlightWeight: 0.55
                }));
              }
            });

            const processedApplication = getSnapshot().applications.find((candidate) => candidate.id === application.id) || application;
            processedIds.push(processedApplication.id);
            setBatchProgress(toBatchProgress({
              total: idsToProcess.length,
              mode: processingMode,
              concurrency,
              processedIds,
              failedIds,
              activeTitles: [...activeTitles.values()].filter((title) => title !== application.title),
              latestTitle: processedApplication.title,
              message: "Automated review stored. Open the reviewed application to download its PDF report.",
              status: batchControlRef.current.stop ? "stopping" : "running",
              inFlightWeight: 0
            }));
          } catch (error) {
            failedIds.push(application.id);
            setBatchProgress(toBatchProgress({
              total: idsToProcess.length,
              mode: processingMode,
              concurrency,
              processedIds,
              failedIds,
              activeTitles: [...activeTitles.values()].filter((title) => title !== application.title),
              latestTitle: application.title,
              message: error instanceof Error ? error.message : "Automated review failed for one application.",
              status: batchControlRef.current.stop ? "stopping" : "running",
              inFlightWeight: 0
            }));
          } finally {
            activeTitles.delete(slot);
          }

          await new Promise((resolve) => window.setTimeout(resolve, 120));
        }
      };

      await Promise.all(Array.from({ length: concurrency }, (_, slot) => runSlot(slot)));
      setSelectedIds((current) => current.filter((id) => !processedIds.includes(id)));
      if (batchControlRef.current.stop) {
        setBatchProgress((current) =>
          current
            ? {
                ...current,
                message: `Batch stopped cleanly after ${processedIds.length} application${processedIds.length === 1 ? "" : "s"} completed${failedIds.length ? ` and ${failedIds.length} failed` : ""}.`,
                percent: Math.round(((processedIds.length + failedIds.length) / idsToProcess.length) * 100),
                processedIds: [...processedIds],
                failedIds: [...failedIds],
                activeTitles: [],
                status: "stopped"
              }
            : current
        );
        messageApi.warning(`Batch stopped after ${processedIds.length} application${processedIds.length === 1 ? "" : "s"}.`);
      } else if (failedIds.length) {
        setBatchProgress((current) =>
          current
            ? {
                ...current,
                message: `Batch finished with ${processedIds.length} completed and ${failedIds.length} failed application${failedIds.length === 1 ? "" : "s"}.`,
                percent: 100,
                processedIds: [...processedIds],
                failedIds: [...failedIds],
                activeTitles: [],
                status: "completed"
              }
            : current
        );
        messageApi.warning(`Processed ${processedIds.length} application${processedIds.length === 1 ? "" : "s"}; ${failedIds.length} failed.`);
      } else {
        setBatchProgress((current) =>
          current
            ? {
                ...current,
                message: "Batch complete. Open any reviewed application to download its PDF report.",
                percent: 100,
                processedIds: [...processedIds],
                failedIds: [...failedIds],
                activeTitles: [],
                status: "completed"
              }
            : current
        );
        messageApi.success(`Processed ${processedIds.length} application${processedIds.length === 1 ? "" : "s"}. Open a reviewed application to download its PDF report.`);
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Batch processing failed.");
    } finally {
      batchControlRef.current = { paused: false, stop: false };
      setBatchRunning(false);
      setBatchPaused(false);
      setBatchStopping(false);
      window.setTimeout(() => setBatchProgress(null), 2400);
    }
  };

  const waitWhileBatchPaused = async (
    total: number,
    processedIds: string[],
    failedIds: string[],
    mode: ProcessingMode,
    concurrency: number,
    activeTitles: Map<number, string>
  ) => {
    if (!batchControlRef.current.paused || batchControlRef.current.stop) return;
    setBatchProgress((current) => toBatchProgress({
      total,
      latestTitle: current?.applicationTitle || "Batch paused",
      message: "Batch paused. Resume when ready, or stop to end after the last completed application.",
      processedIds,
      failedIds,
      activeTitles: [...activeTitles.values()],
      mode,
      concurrency,
      status: "paused"
    }));
    while (batchControlRef.current.paused && !batchControlRef.current.stop) {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }
  };

  const pauseBatch = () => {
    if (!batchRunning || batchPaused || batchStopping) return;
    batchControlRef.current.paused = true;
    setBatchPaused(true);
    setBatchProgress((current) =>
      current
        ? {
            ...current,
            message: `${current.message} Pause requested; active application reviews will finish safely.`,
            status: "paused"
          }
        : current
    );
  };

  const resumeBatch = () => {
    if (!batchRunning || !batchPaused || batchStopping) return;
    batchControlRef.current.paused = false;
    setBatchPaused(false);
    setBatchProgress((current) =>
      current
        ? {
            ...current,
            message: "Batch resumed. Continuing with the next selected application.",
            status: "running"
          }
        : current
    );
  };

  const stopBatch = () => {
    if (!batchRunning || batchStopping) return;
    batchControlRef.current.stop = true;
    batchControlRef.current.paused = false;
    setBatchPaused(false);
    setBatchStopping(true);
    setBatchProgress((current) =>
      current
        ? {
            ...current,
            message: "Stop requested. Active application reviews will finish safely, then the batch will end.",
            status: "stopping"
          }
        : current
    );
  };

  const columns: ColumnsType<ReviewApplication> = [
    {
      title: "Priority",
      width: 90,
      sorter: (left, right) => queuePriority(right).score - queuePriority(left).score,
      render: (_, application) => {
        const priority = queuePriority(application);
        return <Tag color={priority.tone}>{priority.label}</Tag>;
      }
    },
    {
      title: "Application date",
      width: 110,
      sorter: (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
      render: (_, application) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text>{dayjs(application.createdAt).format("MMM D, YYYY")}</Typography.Text>
          <Typography.Text type="secondary">{dayjs(application.createdAt).format("h:mm A")}</Typography.Text>
        </Space>
      )
    },
    {
      title: "Application #",
      width: 220,
      sorter: (left, right) => applicationLabel(left).localeCompare(applicationLabel(right)),
      render: (_, application) => (
        <Space orientation="vertical" size={1}>
          <strong>{applicationNumberFor(application)}</strong>
          <Typography.Text>{application.expectedFields.brandName}</Typography.Text>
          <Typography.Link onClick={() => navigate(`/reviewer/applications/${application.id}`)}>{application.title}</Typography.Link>
        </Space>
      )
    },
    {
      title: "Company",
      width: 175,
      sorter: (left, right) => left.submitter.localeCompare(right.submitter),
      render: (_, application) => (
        <Space orientation="vertical" size={1}>
          <Typography.Text>{application.submitter}</Typography.Text>
          <Typography.Text type="secondary">{application.expectedFields.producerName || "Producer not supplied"}</Typography.Text>
        </Space>
      )
    },
    {
      title: "Type",
      width: 170,
      sorter: (left, right) => typeLabel(left).localeCompare(typeLabel(right)),
      render: (_, application) => (
        <Space orientation="vertical" size={1}>
          <Typography.Text>{application.expectedFields.productType.replaceAll("_", " ")}</Typography.Text>
          <Typography.Text type="secondary">{application.expectedFields.classType}</Typography.Text>
        </Space>
      )
    },
    {
      title: "Review state",
      width: 155,
      sorter: (left, right) => left.status.localeCompare(right.status),
      render: (_, application) => (
        <Space orientation="vertical" size={4}>
          <StatusTag status={application.status} />
          {application.review ? <Tag color="green" icon={<CheckCircleOutlined />}>Processed</Tag> : <Tag color="blue">Not processed</Tag>}
        </Space>
      )
    },
    {
      title: "Automated finding",
      width: 230,
      render: (_, application) => automatedFindingSummary(application)
    },
  ];

  return (
    <Space orientation="vertical" className="full-width" size={16}>
      {contextHolder}
      <Card
        className="batch-review-panel"
        title="Batch Review"
        size="small"
        extra={
          <Space wrap>
            {batchRunning ? (
              <>
                {batchPaused ? (
                  <Button icon={<PlayCircleOutlined />} disabled={batchStopping} onClick={resumeBatch}>
                    Resume
                  </Button>
                ) : (
                  <Button icon={<PauseCircleOutlined />} disabled={batchStopping} onClick={pauseBatch}>
                    Pause
                  </Button>
                )}
                <Button danger icon={<StopOutlined />} disabled={batchStopping} onClick={stopBatch}>
                  Stop
                </Button>
              </>
            ) : null}
            <Button
              type="primary"
              icon={batchRunning ? <LoadingOutlined /> : <AppstoreOutlined />}
              disabled={!selectedProcessableIds.length || batchRunning}
              loading={batchRunning && !batchPaused}
              onClick={() => void runSelectedBatch()}
            >
              Process open batch
            </Button>
          </Space>
        }
      >
        <Space orientation="vertical" className="full-width" size={16}>
          <BatchFilterBar
            search={search}
            companyFilter={companyFilter}
            typeFilter={typeFilter}
            processingFilter={processingFilter}
            dateRange={dateRange}
            onSearchChange={setSearch}
            onCompanyChange={setCompanyFilter}
            onTypeChange={setTypeFilter}
            onProcessingFilterChange={setProcessingFilter}
            onDateRangeChange={setDateRange}
          />

          {batchProgress ? <BatchProgressPanel progress={batchProgress} /> : null}

          {unprocessedCount === 0 ? (
            <GovAlert
              type="success"
              title="All applications have already been processed"
              action={
                <Button icon={<ReloadOutlined />} onClick={resetForBatchTesting}>
                  Reset demo for batch mode testing
                </Button>
              }
            >
              All applications have already been processed, would you like the demo applications reset for batch mode testing?
            </GovAlert>
          ) : null}

          <div className="batch-selection-bar">
            <Checkbox
              checked={allVisibleSelected}
              indeterminate={partiallySelected}
              disabled={!selectableIds.length || batchRunning}
              onChange={selectAllVisible}
            >
              Select all visible unprocessed applications
            </Checkbox>
            <Typography.Text type="secondary">
              {selectedProcessableIds.length} selected · {filteredApplications.length} shown · {unprocessedCount} not processed
            </Typography.Text>
            {filtersActive ? (
              <Button disabled={batchRunning} onClick={clearBatchFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>

          <Table
            rowKey="id"
            dataSource={filteredApplications}
            columns={columns}
            pagination={{ pageSize: 8 }}
            className="batch-review-table"
            scroll={{ x: 1195 }}
            rowSelection={{
              selectedRowKeys: selectedIds,
              preserveSelectedRowKeys: false,
              getCheckboxProps: (application) => ({
                disabled: Boolean(application.review) || batchRunning,
                "aria-label": `Select ${application.title}`
              }),
              onChange: (keys) => setSelectedIds(keys.map(String))
            }}
            locale={{
              emptyText:
                unprocessedCount === 0 ? (
                  <Empty description="All applications have already been processed." />
                ) : (
                  <Empty description="No applications match the current batch filters." />
                )
            }}
          />
          <div className="batch-mobile-list">
            {filteredApplications.length ? (
              filteredApplications.map((application) => (
                <BatchApplicationCard
                  key={application.id}
                  application={application}
                  checked={selectedIds.includes(application.id)}
                  disabled={Boolean(application.review) || batchRunning}
                  onCheckedChange={(checked) =>
                    setSelectedIds((current) =>
                      checked ? [...new Set([...current, application.id])] : current.filter((id) => id !== application.id)
                    )
                  }
                  onOpen={() => navigate(`/reviewer/applications/${application.id}`)}
                />
              ))
            ) : (
              <Empty description={unprocessedCount === 0 ? "All applications have already been processed." : "No applications match the current batch filters."} />
            )}
          </div>
        </Space>
      </Card>
    </Space>
  );
}

function BatchApplicationCard({
  application,
  checked,
  disabled,
  onCheckedChange,
  onOpen
}: {
  application: ReviewApplication;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
  onOpen: () => void;
}) {
  const priority = queuePriority(application);
  return (
    <section className="batch-application-card" aria-label={`${application.title} batch row`}>
      <div className="batch-application-card-header">
        <Checkbox
          checked={checked}
          disabled={disabled}
          aria-label={`Select ${application.title}`}
          onChange={(event) => onCheckedChange(event.target.checked)}
        />
        <Space orientation="vertical" size={2}>
          <Typography.Text strong>{applicationNumberFor(application)}</Typography.Text>
          <Typography.Text>{application.expectedFields.brandName}</Typography.Text>
          <Typography.Text type="secondary">{application.title}</Typography.Text>
        </Space>
        <Button onClick={onOpen}>Open</Button>
      </div>
      <div className="batch-application-card-grid">
        <BatchCardFact label="Priority" value={<Tag color={priority.tone}>{priority.label}</Tag>} />
        <BatchCardFact label="Application date" value={`${dayjs(application.createdAt).format("MMM D, YYYY")} ${dayjs(application.createdAt).format("h:mm A")}`} />
        <BatchCardFact label="Company" value={`${application.submitter}${application.expectedFields.producerName ? ` / ${application.expectedFields.producerName}` : ""}`} />
        <BatchCardFact label="Type" value={`${application.expectedFields.productType.replaceAll("_", " ")} / ${application.expectedFields.classType}`} />
        <BatchCardFact
          label="Review state"
          value={
            <Space wrap>
              <StatusTag status={application.status} />
              {application.review ? <Tag color="green" icon={<CheckCircleOutlined />}>Processed</Tag> : <Tag color="blue">Not processed</Tag>}
            </Space>
          }
        />
        <BatchCardFact label="Automated finding" value={automatedFindingSummary(application)} />
      </div>
    </section>
  );
}

function BatchCardFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="batch-card-fact">
      <Typography.Text type="secondary">{label}</Typography.Text>
      <div>{value}</div>
    </div>
  );
}

function BatchFilterBar({
  search,
  companyFilter,
  typeFilter,
  processingFilter,
  dateRange,
  onSearchChange,
  onCompanyChange,
  onTypeChange,
  onProcessingFilterChange,
  onDateRangeChange
}: {
  search: string;
  companyFilter: string;
  typeFilter: string;
  processingFilter: ProcessingFilter;
  dateRange: [Dayjs, Dayjs] | null;
  onSearchChange: (value: string) => void;
  onCompanyChange: (value: string) => void;
  onTypeChange: (value: string) => void;
  onProcessingFilterChange: (value: ProcessingFilter) => void;
  onDateRangeChange: (value: [Dayjs, Dayjs] | null) => void;
}) {
  return (
    <div className="batch-filter-grid">
      <Input
        aria-label="Search batch applications"
        prefix={<FilterOutlined />}
        allowClear
        placeholder="Search brand, application, applicant, class"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <Input
        aria-label="Filter by company"
        allowClear
        placeholder="Company or producer"
        value={companyFilter}
        onChange={(event) => onCompanyChange(event.target.value)}
      />
      <Input
        aria-label="Filter by type"
        allowClear
        placeholder="Product or class/type"
        value={typeFilter}
        onChange={(event) => onTypeChange(event.target.value)}
      />
      <RangePicker
        aria-label="Application date range"
        value={dateRange}
        onChange={(value) => onDateRangeChange(value as [Dayjs, Dayjs] | null)}
        suffixIcon={<CalendarOutlined />}
        className="full-width"
      />
      <Select
        aria-label="Batch processing status"
        value={processingFilter}
        onChange={onProcessingFilterChange}
        options={[
          { value: "unprocessed", label: "Not processed" },
          { value: "processed", label: "Processed" },
          { value: "all", label: "All applications" }
        ]}
      />
    </div>
  );
}

function BatchProgressPanel({ progress }: { progress: BatchProgress }) {
  const statusTone = progress.status === "paused" ? "orange" : progress.status === "stopping" || progress.status === "stopped" ? "red" : progress.status === "completed" ? "green" : "blue";
  const activeTitles = progress.activeTitles.slice(0, progress.concurrency);
  return (
    <GovAlert type={progress.status === "stopped" ? "warning" : "info"} title={`${progress.status === "paused" ? "Paused" : progress.status === "stopping" ? "Stopping" : progress.status === "stopped" ? "Stopped" : progress.status === "completed" ? "Batch complete" : "Processing"} ${progress.index} of ${progress.total}`}>
      <Space orientation="vertical" className="full-width" size={10}>
        <Space wrap>
          {progress.status === "paused" ? <PauseCircleOutlined /> : progress.status === "stopping" || progress.status === "stopped" ? <StopOutlined /> : progress.status === "completed" ? <CheckCircleOutlined /> : <LoadingOutlined />}
          <Typography.Text strong>{progress.applicationTitle}</Typography.Text>
          <Tag color={statusTone}>{progress.status}</Tag>
          <Tag>{modeLabel(progress.mode)}</Tag>
          <Tag>Parallel slots: {progress.concurrency}</Tag>
        </Space>
        {activeTitles.length ? (
          <Space wrap>
            <LoadingOutlined />
            <Typography.Text type="secondary">
              Active: {activeTitles.join(" · ")}
            </Typography.Text>
          </Space>
        ) : null}
        <Typography.Text>{progress.message}</Typography.Text>
        <Progress
          aria-label="Batch processing progress"
          percent={progress.percent}
          status={progress.status === "stopped" ? "exception" : progress.percent >= 100 ? "success" : progress.status === "paused" ? "normal" : "active"}
        />
        {progress.processedIds.length ? (
          <Space wrap>
            <CheckCircleOutlined />
            <Typography.Text type="secondary">
              {progress.processedIds.length} application{progress.processedIds.length === 1 ? "" : "s"} reviewed. PDF reports are available from each reviewed application.
            </Typography.Text>
          </Space>
        ) : null}
        {progress.failedIds.length ? (
          <Space wrap>
            <StopOutlined />
            <Typography.Text type="secondary">
              {progress.failedIds.length} application{progress.failedIds.length === 1 ? "" : "s"} failed and should be retried after checking worker health.
            </Typography.Text>
          </Space>
        ) : null}
      </Space>
    </GovAlert>
  );
}

function resolveBatchConcurrency(mode: ProcessingMode, selectedCount: number): number {
  const configured = Number.parseInt(String(import.meta.env.VITE_TTB_BATCH_CONCURRENCY || ""), 10);
  const defaultLimit = mode === "backend" ? 2 : 2;
  const limit = Number.isFinite(configured) && configured > 0 ? configured : defaultLimit;
  return Math.max(1, Math.min(selectedCount, limit, 4));
}

function toBatchProgress(state: BatchProgressState): BatchProgress {
  const activeCount = state.activeTitles.length;
  const finishedCount = state.processedIds.length + state.failedIds.length;
  const index = Math.min(state.total, Math.max(1, finishedCount + activeCount));
  const inFlightWeight = state.inFlightWeight ?? (activeCount ? 0.35 : 0);
  const weightedComplete = Math.min(state.total, finishedCount + Math.min(activeCount, state.concurrency) * inFlightWeight);
  const percent = state.total ? Math.min(100, Math.max(5, Math.round((weightedComplete / state.total) * 100))) : 0;
  return {
    index,
    total: state.total,
    applicationTitle: state.activeTitles.length > 1 ? `${state.activeTitles.length} applications in progress` : state.latestTitle,
    message: state.message,
    percent: state.status === "completed" ? 100 : percent,
    processedIds: [...state.processedIds],
    failedIds: [...state.failedIds],
    activeTitles: [...state.activeTitles],
    concurrency: state.concurrency,
    mode: state.mode,
    status: state.status
  };
}

function modeLabel(mode: ProcessingMode): string {
  if (mode === "backend") return "Backend";
  return "Browser";
}

function applicationSearchText(application: ReviewApplication): string {
  return [
    application.title,
    applicationNumberFor(application),
    application.expectedFields.applicationId,
    application.expectedFields.brandName,
    application.expectedFields.fancifulName,
    application.expectedFields.classType,
    application.expectedFields.productType,
    application.expectedFields.producerName,
    application.submitter,
    application.status
  ]
    .filter(Boolean)
    .join(" ");
}

function applicationLabel(application: ReviewApplication): string {
  return `${applicationNumberFor(application)} ${application.expectedFields.brandName}`;
}

function typeLabel(application: ReviewApplication): string {
  return `${application.expectedFields.productType} ${application.expectedFields.classType}`;
}

function matchesFuzzy(value: string, query: string): boolean {
  const normalizedValue = normalizeSearch(value);
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every((token) => normalizedValue.includes(token) || isSubsequence(token, normalizedValue));
}

function isSubsequence(needle: string, haystack: string): boolean {
  let cursor = 0;
  for (const char of haystack) {
    if (char === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return false;
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
