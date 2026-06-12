import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useList } from "@refinedev/core";
import { Navigate, NavLink, useParams } from "react-router";
import { useMemo } from "react";
import { useCurrentRole } from "../../hooks/useCurrentRole";
import { canAccess } from "../../providers/access/permissionMatrix";
import { useProcessingMode } from "../../hooks/useProcessingMode";
import { roleHomePath } from "../../providers/auth/authProvider";
import { consoleResourceNames, isConsoleResourceName, resourceLabels } from "../../resources";

export function ResourceIndexPage() {
  const { resourceName } = useParams();
  const { mode, provider, backendUnavailable, fallbackToBrowser } = useProcessingMode();
  const { role } = useCurrentRole();
  const validResource = isConsoleResourceName(resourceName) ? resourceName : undefined;
  const allowed = Boolean(validResource && canAccess(role, validResource, "list"));
  const list = useList<Record<string, unknown>>({
    resource: validResource,
    pagination: { mode: "off" },
    queryOptions: {
      enabled: allowed && !backendUnavailable,
      retry: false
    },
    errorNotification: false
  });

  const rows = list.result.data;
  const columns = useMemo(() => buildColumns(rows), [rows]);

  if (!validResource) {
    return (
      <Card size="small" title="Resources">
        <Alert type="warning" showIcon title="Unknown resource" description="Choose one of the registered console resources." />
        <ResourceLinks />
      </Card>
    );
  }

  if (!allowed) {
    return <Navigate to={roleHomePath(role)} replace />;
  }

  return (
    <Space orientation="vertical" className="full-width" size={16}>
      {backendUnavailable ? (
        <Alert
          type="warning"
          showIcon
          title="Backend coordinator unavailable"
          description="This resource is registered to the FastAPI provider in Backend and Cluster modes. Switch to Browser Only to keep reviewing offline."
          action={<Button onClick={fallbackToBrowser}>Use Browser Only</Button>}
        />
      ) : null}
      {list.query.isError ? (
        <Alert
          type="error"
          showIcon
          title={`Could not load ${resourceLabels[validResource]}`}
          description={list.query.error?.message || "The active provider returned an error."}
        />
      ) : null}
      <Card
        size="small"
        title={resourceLabels[validResource]}
        extra={
          <Space wrap>
            <Tag>{mode}</Tag>
            <Tag>{provider.label}</Tag>
            <Button icon={<ReloadOutlined />} onClick={() => list.query.refetch()} loading={list.query.isFetching}>
              Refresh
            </Button>
          </Space>
        }
      >
        {rows.length ? (
          <Table rowKey={(record) => String(record.id ?? record.key ?? JSON.stringify(record).slice(0, 80))} dataSource={rows} columns={columns} pagination={{ pageSize: 10 }} scroll={{ x: 900 }} />
        ) : (
          <Empty description={list.query.isFetching ? "Loading resource records" : "This provider has no records for the selected resource"} />
        )}
      </Card>
      <ResourceLinks />
    </Space>
  );
}

function ResourceLinks() {
  const { role } = useCurrentRole();
  const visibleResources = consoleResourceNames.filter((name) => canAccess(role, name, "list"));

  return (
    <Card size="small" title="Registered Resources">
      <Space wrap>
        {visibleResources.map((name) => (
          <NavLink key={name} to={`/resources/${name}`}>
            {resourceLabels[name]}
          </NavLink>
        ))}
      </Space>
    </Card>
  );
}

function buildColumns(rows: Record<string, unknown>[]): ColumnsType<Record<string, unknown>> {
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 7);
  const selectedKeys = keys.length ? keys : ["id"];
  return selectedKeys.map((key) => ({
    title: labelize(key),
    dataIndex: key,
    ellipsis: true,
    render: (value: unknown) => <Typography.Text>{formatValue(value)}</Typography.Text>
  }));
}

function labelize(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || typeof value === "undefined") return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
