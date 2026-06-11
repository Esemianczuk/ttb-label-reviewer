import { LockOutlined } from "@ant-design/icons";
import { Button, Result } from "antd";
import { Link } from "react-router";

export function AccessDeniedPage() {
  return (
    <Result
      icon={<LockOutlined />}
      status="403"
      title="Access denied"
      subTitle="Your current role cannot open this workspace."
      extra={
        <Button type="primary">
          <Link to="/">Go to role landing</Link>
        </Button>
      }
    />
  );
}
