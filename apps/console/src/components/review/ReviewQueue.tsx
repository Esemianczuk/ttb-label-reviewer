import { CalendarOutlined, FilterOutlined } from "@ant-design/icons";
import { Button, Card, DatePicker, Empty, Input, Select, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Key, ReactNode } from "react";
import { useSubscription } from "@refinedev/core";
import { useNavigate, useSearchParams } from "react-router";
import type { ReviewApplication } from "../../domain/application/types";
import { applicationNumberFor } from "../../domain/application/applicationNumber";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { useProcessingModeContext } from "../../providers/processing/ProcessingModeProvider";
import { setActiveApplication } from "../../providers/data/browserStore";
import { StatusTag } from "../common/StatusTag";
import {
  REVIEWER_QUEUE_FILTERS,
  type ReviewerQueueFilter,
  automatedFindingSummary,
  criticalFieldLabels,
  matchesReviewerFilter,
  queuePriority,
  reviewerQueueApplications
} from "../../pages/reviewer/reviewerUtils";

const { RangePicker } = DatePicker;

type ProcessingFilter = "unprocessed" | "processed" | "all";

export function ReviewQueue({ title = "Review Queue", compact = false }: { title?: string; compact?: boolean }) {
  const { snapshot } = useConsoleStore();
  const { mode, backendUnavailable, dataProvider } = useProcessingModeContext();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [processingFilter, setProcessingFilter] = useState<ProcessingFilter>("all");
  const [filter, setFilter] = useState<ReviewerQueueFilter>(() => queueFilterFromSearch(searchParams.get("filter")));
  const [remoteApplications, setRemoteApplications] = useState<ReviewApplication[] | null>(null);
  const [expandedIds, setExpandedIds] = useState<Key[]>([]);
  const backendQueueEnabled = mode !== "browser" && !backendUnavailable;
  const fromDashboard = searchParams.get("from") === "dashboard";
  const filterLabel = REVIEWER_QUEUE_FILTERS.find((item) => item.value === filter)?.label || "All";

  useEffect(() => {
    setFilter(queueFilterFromSearch(searchParams.get("filter")));
  }, [searchParams]);

  const applyFilter = (nextFilter: ReviewerQueueFilter) => {
    setFilter(nextFilter);
    const next = new URLSearchParams(searchParams);
    if (nextFilter === "all") next.delete("filter");
    else next.set("filter", nextFilter);
    setSearchParams(next, { replace: true });
  };

  const refreshRemoteQueue = useCallback(async () => {
    if (!backendQueueEnabled) {
      setRemoteApplications(null);
      return;
    }
    const response = await dataProvider.getList({ resource: "applications", pagination: { mode: "off" } });
    setRemoteApplications(response.data.map(normalizeBackendApplication));
  }, [backendQueueEnabled, dataProvider]);

  useEffect(() => {
    void refreshRemoteQueue();
  }, [refreshRemoteQueue]);

  useSubscription({ channel: "resources/applications", types: ["*"], enabled: backendQueueEnabled, onLiveEvent: () => void refreshRemoteQueue() });
  useSubscription({ channel: "resources/reviews", types: ["*"], enabled: backendQueueEnabled, onLiveEvent: () => void refreshRemoteQueue() });

  const queueApplications = backendQueueEnabled && remoteApplications ? remoteApplications : snapshot.applications;
  const data = useMemo(
    () =>
      reviewerQueueApplications(queueApplications).filter((application) => {
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
        return matchesReviewerFilter(application, filter);
      }),
    [companyFilter, dateRange, filter, processingFilter, queueApplications, search, typeFilter]
  );

  const openApplication = (application: ReviewApplication) => {
    setActiveApplication(application.id);
    navigate(`/reviewer/applications/${application.id}`);
  };

  const toggleExpanded = (applicationId: string) => {
    setExpandedIds((current) => (current.includes(applicationId) ? current.filter((id) => id !== applicationId) : [...current, applicationId]));
  };

  const quickFilters: Array<{ label: string; value: ReviewerQueueFilter }> = [
    { label: "Missing warning", value: "missing_government_warning" },
    { label: "Alcohol mismatch", value: "abv_mismatch" },
    { label: "Net contents mismatch", value: "net_contents_mismatch" },
    { label: "Low confidence", value: "low_confidence" },
    { label: "Needs correction", value: "needs_correction" },
    { label: "Assigned to me", value: "assigned_to_me" }
  ];

  const columns: ColumnsType<ReviewApplication> = [
    {
      title: "Priority",
      width: 110,
      sorter: (left, right) => queuePriority(right).score - queuePriority(left).score,
      render: (_, application) => {
        const priority = queuePriority(application);
        return <Tag color={priority.tone}>{priority.label}</Tag>;
      }
    },
    {
      title: "Application",
      width: 300,
      sorter: (left, right) => applicationLabel(left).localeCompare(applicationLabel(right)),
      render: (_, application) => (
        <Space orientation="vertical" size={2} className="queue-application-cell">
          <Typography.Text strong>{applicationNumberFor(application)}</Typography.Text>
          <Typography.Link onClick={() => openApplication(application)}>{application.expectedFields.brandName || application.title}</Typography.Link>
          <Typography.Text type="secondary">{application.title}</Typography.Text>
        </Space>
      )
    },
    {
      title: "Product",
      width: 230,
      sorter: (left, right) => typeLabel(left).localeCompare(typeLabel(right)),
      render: (_, application) => (
        <Space orientation="vertical" size={2}>
          <Typography.Text>{application.expectedFields.productType.replaceAll("_", " ")}</Typography.Text>
          <Typography.Text type="secondary">{application.expectedFields.classType}</Typography.Text>
        </Space>
      )
    },
    {
      title: "Applicant",
      width: 220,
      responsive: ["md"],
      sorter: (left, right) => left.submitter.localeCompare(right.submitter),
      render: (_, application) => (
        <Space orientation="vertical" size={2}>
          <Typography.Text>{application.submitter}</Typography.Text>
          <Typography.Text type="secondary">{application.expectedFields.producerName || "Producer not supplied"}</Typography.Text>
        </Space>
      )
    },
    {
      title: "Submitted",
      width: 145,
      responsive: ["lg"],
      sorter: (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
      render: (_, application) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text>{dayjs(application.createdAt).format("MMM D, YYYY")}</Typography.Text>
          <Typography.Text type="secondary">{dayjs(application.createdAt).format("h:mm A")}</Typography.Text>
        </Space>
      )
    },
    {
      title: "Review State",
      width: 170,
      sorter: (left, right) => left.status.localeCompare(right.status),
      render: (_, application) => (
        <Space orientation="vertical" size={5} className="queue-state-cell">
          <StatusTag status={application.status} />
          {application.review ? <Tag color="green">Processed</Tag> : <Tag color="blue">Not processed</Tag>}
        </Space>
      )
    },
    {
      title: "Finding",
      width: 280,
      render: (_, application) => <Typography.Text className="queue-finding-text">{automatedFindingSummary(application)}</Typography.Text>
    },
    {
      title: "Actions",
      width: 180,
      align: "right",
      render: (_, application) => {
        const expanded = expandedIds.includes(application.id);
        return (
          <Space wrap className="queue-action-row">
            <Button onClick={() => toggleExpanded(application.id)}>{expanded ? "Hide overview" : "Overview"}</Button>
            <Button type="primary" onClick={() => openApplication(application)}>
              Open
            </Button>
          </Space>
        );
      }
    }
  ];

  return (
    <Card title={title} size="small" className="review-queue-panel">
      <Space orientation="vertical" className="full-width" size={16}>
        <QueueFilterBar
          filter={filter}
          search={search}
          companyFilter={companyFilter}
          typeFilter={typeFilter}
          processingFilter={processingFilter}
          dateRange={dateRange}
          onFilterChange={applyFilter}
          onSearchChange={setSearch}
          onCompanyChange={setCompanyFilter}
          onTypeChange={setTypeFilter}
          onProcessingFilterChange={setProcessingFilter}
          onDateRangeChange={setDateRange}
        />

        {filter !== "all" || fromDashboard ? (
          <div className="queue-filter-banner">
            <Typography.Text strong>{filter === "all" ? "Review queue" : `Filtered: ${filterLabel}`}</Typography.Text>
            <Space wrap>
              {filter !== "all" ? <Button onClick={() => applyFilter("all")}>Clear filter</Button> : null}
              {fromDashboard ? <Button onClick={() => navigate("/reviewer")}>Back to dashboard</Button> : null}
            </Space>
          </div>
        ) : null}

        <Space wrap className="review-filter-chips">
          {quickFilters.map((item) => (
            <Button
              key={item.value}
              size="small"
              type={filter === item.value ? "primary" : "default"}
              onClick={() => applyFilter(filter === item.value ? "all" : item.value)}
            >
              {item.label}
            </Button>
          ))}
        </Space>

        <div className="queue-result-summary">
          <Typography.Text type="secondary">
            {data.length} shown · {queueApplications.filter((application) => !application.review).length} not processed · open a packet to run automated review
          </Typography.Text>
        </div>

        <Table
          rowKey="id"
          dataSource={data}
          columns={columns}
          pagination={{ pageSize: compact ? 5 : 8, showSizeChanger: false }}
          className="review-queue-table"
          scroll={{ x: compact ? 980 : 1260 }}
          rowClassName={() => (filter === "all" ? "" : "queue-row-highlight")}
          expandable={{
            expandedRowKeys: expandedIds,
            onExpandedRowsChange: (keys) => setExpandedIds([...keys]),
            expandedRowRender: (application) => <QueueExpandedOverview application={application} onOpen={() => openApplication(application)} />,
            expandRowByClick: false
          }}
          locale={{
            emptyText: <Empty description="No applications match the current queue filters." />
          }}
        />

        <div className="queue-mobile-list">
          {data.length ? (
            data.map((application) => (
              <QueueApplicationCard
                key={application.id}
                application={application}
                expanded={expandedIds.includes(application.id)}
                onToggleExpanded={() => toggleExpanded(application.id)}
                onOpen={() => openApplication(application)}
              />
            ))
          ) : (
            <Empty description="No applications match the current queue filters." />
          )}
        </div>
      </Space>
    </Card>
  );
}

function QueueFilterBar({
  filter,
  search,
  companyFilter,
  typeFilter,
  processingFilter,
  dateRange,
  onFilterChange,
  onSearchChange,
  onCompanyChange,
  onTypeChange,
  onProcessingFilterChange,
  onDateRangeChange
}: {
  filter: ReviewerQueueFilter;
  search: string;
  companyFilter: string;
  typeFilter: string;
  processingFilter: ProcessingFilter;
  dateRange: [Dayjs, Dayjs] | null;
  onFilterChange: (value: ReviewerQueueFilter) => void;
  onSearchChange: (value: string) => void;
  onCompanyChange: (value: string) => void;
  onTypeChange: (value: string) => void;
  onProcessingFilterChange: (value: ProcessingFilter) => void;
  onDateRangeChange: (value: [Dayjs, Dayjs] | null) => void;
}) {
  return (
    <div className="queue-filter-grid">
      <Select
        aria-label="Queue filter"
        value={filter}
        onChange={(value) => onFilterChange(value as ReviewerQueueFilter)}
        options={REVIEWER_QUEUE_FILTERS}
      />
      <Input
        aria-label="Search review queue"
        prefix={<FilterOutlined />}
        allowClear
        placeholder="Search brand, application, applicant, class"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <Input
        aria-label="Filter queue by company"
        allowClear
        placeholder="Company or producer"
        value={companyFilter}
        onChange={(event) => onCompanyChange(event.target.value)}
      />
      <Input
        aria-label="Filter queue by type"
        allowClear
        placeholder="Product or class/type"
        value={typeFilter}
        onChange={(event) => onTypeChange(event.target.value)}
      />
      <RangePicker
        aria-label="Review queue date range"
        value={dateRange}
        onChange={(value) => onDateRangeChange(value as [Dayjs, Dayjs] | null)}
        suffixIcon={<CalendarOutlined />}
        className="full-width"
      />
      <Select
        aria-label="Queue processing status"
        value={processingFilter}
        onChange={onProcessingFilterChange}
        options={[
          { value: "all", label: "All processing states" },
          { value: "unprocessed", label: "Not processed" },
          { value: "processed", label: "Processed" }
        ]}
      />
    </div>
  );
}

function QueueExpandedOverview({ application, onOpen }: { application: ReviewApplication; onOpen: () => void }) {
  const priority = queuePriority(application);
  return (
    <div className="queue-expanded-overview">
      <div className="queue-overview-header">
        <Space orientation="vertical" size={2}>
          <Typography.Text strong>{application.title}</Typography.Text>
          <Typography.Text type="secondary">{application.metadata.description || "No packet description supplied."}</Typography.Text>
        </Space>
        <Button type="primary" onClick={onOpen}>
          Open workbench
        </Button>
      </div>
      <div className="queue-overview-grid">
        <QueueFact label="Priority" value={<Tag color={priority.tone}>{priority.label}</Tag>} />
        <QueueFact label="Application #" value={applicationNumberFor(application)} />
        <QueueFact label="Applicant" value={application.submitter} />
        <QueueFact label="Submitted" value={`${dayjs(application.createdAt).format("MMM D, YYYY")} ${dayjs(application.createdAt).format("h:mm A")}`} />
        <QueueFact label="Product type" value={application.expectedFields.productType.replaceAll("_", " ")} />
        <QueueFact label="Class / type" value={application.expectedFields.classType || "Not supplied"} />
        <QueueFact label="Alcohol content" value={application.expectedFields.alcoholContent || "Not supplied"} />
        <QueueFact label="Net contents" value={application.expectedFields.netContents || "Not supplied"} />
        <QueueFact label="Images" value={`${application.images.length} label image${application.images.length === 1 ? "" : "s"}`} />
        <QueueFact label="Critical fields" value={criticalFieldLabels(application)} />
        <QueueFact label="Automated finding" value={automatedFindingSummary(application)} wide />
        <QueueFact label="Reviewer" value={application.assignedTo || "Unassigned"} />
      </div>
      {application.metadata.notes ? (
        <div className="queue-overview-note">
          <Typography.Text type="secondary">Record notes</Typography.Text>
          <Typography.Text>{application.metadata.notes}</Typography.Text>
        </div>
      ) : null}
    </div>
  );
}

function QueueApplicationCard({
  application,
  expanded,
  onToggleExpanded,
  onOpen
}: {
  application: ReviewApplication;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpen: () => void;
}) {
  const priority = queuePriority(application);
  return (
    <section className="queue-application-card" aria-label={`${application.title} review queue row`}>
      <div className="queue-application-card-header">
        <Space orientation="vertical" size={2}>
          <Typography.Text strong>{applicationNumberFor(application)}</Typography.Text>
          <Typography.Text>{application.expectedFields.brandName || application.title}</Typography.Text>
          <Typography.Text type="secondary">{application.title}</Typography.Text>
        </Space>
        <Tag color={priority.tone}>{priority.label}</Tag>
      </div>
      <div className="queue-card-grid">
        <QueueFact label="Product" value={`${application.expectedFields.productType.replaceAll("_", " ")} / ${application.expectedFields.classType}`} />
        <QueueFact label="Applicant" value={application.submitter} />
        <QueueFact label="Review state" value={<Space wrap><StatusTag status={application.status} />{application.review ? <Tag color="green">Processed</Tag> : <Tag color="blue">Not processed</Tag>}</Space>} />
        <QueueFact label="Finding" value={automatedFindingSummary(application)} />
      </div>
      {expanded ? <QueueExpandedOverview application={application} onOpen={onOpen} /> : null}
      <Space wrap className="queue-action-row">
        <Button onClick={onToggleExpanded}>{expanded ? "Hide overview" : "Overview"}</Button>
        <Button type="primary" onClick={onOpen}>
          Open
        </Button>
      </Space>
    </section>
  );
}

function QueueFact({ label, value, wide = false }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "queue-fact queue-fact-wide" : "queue-fact"}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <div>{value}</div>
    </div>
  );
}

function queueFilterFromSearch(value: string | null): ReviewerQueueFilter {
  return REVIEWER_QUEUE_FILTERS.some((filter) => filter.value === value) ? (value as ReviewerQueueFilter) : "all";
}

function normalizeBackendApplication(row: any): ReviewApplication {
  const expectedFields = row.expectedFields || {};
  const metadata = row.metadata || {};
  return {
    id: row.id,
    title: expectedFields.brandName || metadata.applicationId || row.id,
    source: row.source || "manual",
    status: row.canonicalStatus || row.status || "SUBMITTED",
    expectedOutcome: "NEEDS_REVIEW",
    expectedFields: {
      productType: expectedFields.productType || "unknown",
      brandName: expectedFields.brandName || "Unknown Brand",
      fancifulName: expectedFields.fancifulName,
      classType: expectedFields.classType || "Unknown Class",
      alcoholContent: expectedFields.alcoholContent || "unknown",
      netContents: expectedFields.netContents || "unknown",
      governmentWarningRequired: Boolean(expectedFields.governmentWarningRequired),
      producerName: expectedFields.producerName,
      countryOfOrigin: expectedFields.countryOfOrigin,
      applicationId: expectedFields.applicationId || metadata.applicationId || row.id,
      labelId: expectedFields.labelId
    },
    images: [],
    submitter: row.ownerUserId || "Backend applicant",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    metadata
  } as ReviewApplication;
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
    application.assignedTo,
    application.status,
    automatedFindingSummary(application)
  ]
    .filter(Boolean)
    .join(" ");
}

function applicationLabel(application: ReviewApplication): string {
  return `${applicationNumberFor(application)} ${application.expectedFields.brandName} ${application.title}`;
}

function typeLabel(application: ReviewApplication): string {
  return `${application.expectedFields.productType} ${application.expectedFields.classType}`;
}

function matchesFuzzy(value: string, query: string): boolean {
  const normalizedValue = normalizeSearch(value);
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
  return tokens.every((token) => normalizedValue.includes(token));
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
