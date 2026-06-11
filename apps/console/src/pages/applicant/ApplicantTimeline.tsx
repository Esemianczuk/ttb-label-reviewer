import { Card, Space, Timeline, Typography } from "antd";
import { Link, useParams } from "react-router";
import { StatusTag } from "../../components/common/StatusTag";
import { useConsoleStore } from "../../hooks/useConsoleStore";

export function ApplicantTimeline() {
  const { applicationId } = useParams();
  const { snapshot } = useConsoleStore();
  const application = snapshot.applications.find((candidate) => candidate.id === applicationId);
  const events = snapshot.auditEvents.filter((event) => event.metadata?.applicationId === applicationId || event.summary.includes(applicationId || ""));

  if (!application) return <Card size="small">Application not found.</Card>;

  return (
    <Space orientation="vertical" className="full-width" size={16}>
      <Card size="small" title={`${application.title} Timeline`} extra={<StatusTag status={application.status} />}>
        <Typography.Text type="secondary">{application.id}</Typography.Text>
      </Card>
      <Card size="small">
        <Timeline
          items={(events.length ? events : snapshot.auditEvents.slice(0, 5)).map((event) => ({
            children: (
              <Space orientation="vertical" size={1}>
                <Typography.Text strong>{event.action}</Typography.Text>
                <Typography.Text>{event.summary}</Typography.Text>
                <Typography.Text type="secondary">{event.createdAt}</Typography.Text>
              </Space>
            )
          }))}
        />
      </Card>
      <Card size="small">
        <Link to={`/applicant/applications/${application.id}`}>Application Detail</Link>
      </Card>
    </Space>
  );
}
