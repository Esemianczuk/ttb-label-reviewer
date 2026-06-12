import { LockOutlined } from "@ant-design/icons";
import { Button, Result } from "antd";
import { useNavigate } from "react-router";

export function AccessDeniedPage() {
  const navigate = useNavigate();

  return (
    <Result
      icon={<LockOutlined />}
      status="403"
      title="Access denied"
      subTitle="Your current role cannot open this workspace."
      extra={
        <Button type="primary" onClick={() => navigate("/")}>
          Go to role landing
        </Button>
      }
    />
  );
}
