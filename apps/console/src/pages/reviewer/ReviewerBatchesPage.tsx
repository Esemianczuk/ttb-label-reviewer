import {
  AppstoreOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  FilterOutlined,
  LoadingOutlined,
  ReloadOutlined
} from "@ant-design/icons";
import { Button, Card, Checkbox, DatePicker, Empty, Input, Progress, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { CheckboxChangeEvent } from "antd/es/checkbox";
import dayjs, { type Dayjs } from "dayjs";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { downloadApplicationPdf } from "../../components/common/PdfExportButton";
import { StatusTag } from "../../components/common/StatusTag";
import { applicationNumberFor } from "../../domain/application/applicationNumber";
import { GovAlert } from "../../components/common/GovAlert";
import type { ReviewApplication } from "../../domain/application/types";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { autoReviewApplicationWithBrowserOcr, getSnapshot, resetSnapshot } from "../../providers/data/browserStore";
import { automatedFindingSummary, queuePriority, reviewerQueueApplications } from "./reviewerUtils";

const { RangePicker } = DatePicker;

type ProcessingFilter = "unprocessed" | "processed" | "all";

type BatchProgress = {
  index: number;
  total: number;
  applicationTitle: string;
  message: string;
  percent: number;
  completedIds: string[];
};

export function ReviewerBatchesPage() {
  const { snapshot } = useConsoleStore();
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

  const selectAllVisible = (event: CheckboxChangeEvent) => {
    setSelectedIds(event.target.checked ? selectableIds : []);
  };

  const resetForBatchTesting = () => {
    resetSnapshot();
    setSelectedIds([]);
    setProcessingFilter("unprocessed");
    setSearch("");
    setCompanyFilter("");
    setTypeFilter("");
    setDateRange(null);
    messageApi.success("Demo applications reset for batch testing.");
  };

  const runSelectedBatch = async () => {
    if (!selectedProcessableIds.length || batchRunning) return;
    setBatchRunning(true);
    const idsToProcess = [...selectedProcessableIds];
    const completedIds: string[] = [];

    try {
      for (let index = 0; index < idsToProcess.length; index += 1) {
        const application = getSnapshot().applications.find((candidate) => candidate.id === idsToProcess[index]);
        if (!application) continue;
        const basePercent = Math.round((index / idsToProcess.length) * 100);
        setBatchProgress({
          index: index + 1,
          total: idsToProcess.length,
          applicationTitle: application.title,
          message: "Reading label text and matching expected fields.",
          percent: Math.max(basePercent, 5),
          completedIds: [...completedIds]
        });

        await autoReviewApplicationWithBrowserOcr(application.id, "browser", {
          onProgress: (progressMessage) => {
            setBatchProgress({
              index: index + 1,
              total: idsToProcess.length,
              applicationTitle: application.title,
              message: progressMessage,
              percent: Math.min(95, Math.round(((index + 0.65) / idsToProcess.length) * 100)),
              completedIds: [...completedIds]
            });
          }
        });

        const processedApplication = getSnapshot().applications.find((candidate) => candidate.id === application.id) || application;
        setBatchProgress({
          index: index + 1,
          total: idsToProcess.length,
          applicationTitle: processedApplication.title,
          message: "Generating PDF packet.",
          percent: Math.min(98, Math.round(((index + 0.9) / idsToProcess.length) * 100)),
          completedIds: [...completedIds]
        });
        await downloadApplicationPdf(processedApplication, "Batch Review");
        completedIds.push(processedApplication.id);
        setBatchProgress({
          index: index + 1,
          total: idsToProcess.length,
          applicationTitle: processedApplication.title,
          message: "PDF downloaded. Moving to the next application.",
          percent: Math.round(((index + 1) / idsToProcess.length) * 100),
          completedIds: [...completedIds]
        });
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      setSelectedIds([]);
      messageApi.success(`Processed ${completedIds.length} application${completedIds.length === 1 ? "" : "s"} and downloaded PDFs.`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Batch processing failed.");
    } finally {
      setBatchRunning(false);
      window.setTimeout(() => setBatchProgress(null), 1500);
    }
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
          <Button
            type="primary"
            icon={batchRunning ? <LoadingOutlined /> : <AppstoreOutlined />}
            disabled={!selectedProcessableIds.length || batchRunning}
            loading={batchRunning}
            onClick={() => void runSelectedBatch()}
          >
            Process open batch
          </Button>
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
  return (
    <GovAlert type="info" title={`Processing ${progress.index} of ${progress.total}`}>
      <Space orientation="vertical" className="full-width" size={10}>
        <Space>
          <LoadingOutlined />
          <Typography.Text strong>{progress.applicationTitle}</Typography.Text>
        </Space>
        <Typography.Text>{progress.message}</Typography.Text>
        <Progress aria-label="Batch processing progress" percent={progress.percent} status={progress.percent >= 100 ? "success" : "active"} />
        {progress.completedIds.length ? (
          <Space>
            <DownloadOutlined />
            <Typography.Text type="secondary">
              PDFs downloaded for {progress.completedIds.length} application{progress.completedIds.length === 1 ? "" : "s"}.
            </Typography.Text>
          </Space>
        ) : null}
      </Space>
    </GovAlert>
  );
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
