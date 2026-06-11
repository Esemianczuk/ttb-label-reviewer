import type { NotificationInstance } from "antd/es/notification/interface";
import type { NotificationProvider } from "@refinedev/core";

export function createNotificationProvider(notification: NotificationInstance): NotificationProvider {
  return {
    open: ({ key, message, description, type }) => {
      const method = type === "error" ? "error" : type === "success" ? "success" : "info";
      notification[method]({ key, message, description });
    },
    close: (key) => notification.destroy(key)
  };
}
