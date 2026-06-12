import { Card, Space, Timeline, Typography } from "antd";
import { Link, useParams } from "react-router";
import { StatusTag } from "../../components/common/StatusTag";
import { applicationNumberFor } from "../../domain/application/applicationNumber";
import { useConsoleStore } from "../../hooks/useConsoleStore";

export function ApplicantTimeline() {
  const { applicationId } = useParams();
  const { snapshot } = useConsoleStore();
  const application = snapshot.applications.find((candidate) => candidate.id === applicationId);
  const applicationNumber = applicationNumberFor(application);
  const events = snapshot.auditEvents.filter(
    (event) => event.metadata?.applicationId === applicationId || event.metadata?.applicationNumber === applicationNumber || event.summary.includes(applicationId || "") || event.summary.includes(applicationNumber)
  );

  if (!application) return <Card size="small">Application not found.</Card>;

  return (
    <Space orientation="vertical" className="full-width" size={16}>
      <Card size="small" title={`${application.title} Timeline`} extra={<StatusTag status={application.status} />}>
        <Typography.Text type="secondary">Application # {applicationNumber}</Typography.Text>
      </Card>
      <Card size="small">
        <Timeline
          items={(events.length ? events : snapshot.auditEvents.slice(0, 5)).map((event) => ({
            content: (
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
