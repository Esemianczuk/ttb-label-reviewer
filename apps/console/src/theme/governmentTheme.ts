import type { ThemeConfig } from "antd";

const fontFamily =
  '"Public Sans", "Source Sans 3", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const governmentTheme: ThemeConfig = {
  token: {
    colorPrimary: "#1A4480",
    colorInfo: "#005EA8",
    colorSuccess: "#2E8540",
    colorWarning: "#FFBE2E",
    colorError: "#B50909",
    colorText: "#1B1B1B",
    colorTextSecondary: "#565C65",
    colorBgBase: "#F7F9FA",
    colorBgContainer: "#FFFFFF",
    colorBgLayout: "#F7F9FA",
    colorBorder: "#DFE1E2",
    colorBorderSecondary: "#E6E6E6",
    colorLink: "#005EA8",
    colorLinkHover: "#1A6FB3",
    controlHeight: 42,
    borderRadius: 4,
    fontFamily,
    fontSize: 16,
    lineHeight: 1.5,
    wireframe: false
  },
  components: {
    Alert: {
      borderRadiusLG: 4,
      colorInfoBg: "#E7F6FF",
      colorWarningBg: "#FFF5C2",
      colorErrorBg: "#F8DFE2",
      colorSuccessBg: "#EAF4DD"
    },
    Button: {
      borderRadius: 4,
      controlHeight: 42,
      fontWeight: 700,
      primaryShadow: "none"
    },
    Card: {
      borderRadiusLG: 4,
      headerBg: "#FFFFFF",
      headerFontSize: 18
    },
    Drawer: {
      borderRadiusLG: 4
    },
    Form: {
      labelColor: "#1B1B1B",
      labelFontSize: 16,
      itemMarginBottom: 18
    },
    Input: {
      borderRadius: 4,
      controlHeight: 42
    },
    Layout: {
      bodyBg: "#F7F9FA",
      headerBg: "#162E51",
      siderBg: "#FFFFFF",
      triggerBg: "#162E51"
    },
    Menu: {
      itemBg: "#FFFFFF",
      itemColor: "#1B1B1B",
      itemHoverBg: "#E7F6FF",
      itemHoverColor: "#005EA8",
      itemSelectedBg: "#D9E8F6",
      itemSelectedColor: "#162E51"
    },
    Modal: {
      borderRadiusLG: 4
    },
    Select: {
      borderRadius: 4,
      controlHeight: 42
    },
    Steps: {
      colorPrimary: "#005EA8",
      titleLineHeight: 1.35
    },
    Table: {
      borderColor: "#DFE1E2",
      cellFontSize: 15,
      cellPaddingBlock: 10,
      cellPaddingInline: 12,
      headerBg: "#F0F0F0",
      headerColor: "#1B1B1B",
      rowHoverBg: "#F7F9FA"
    },
    Tabs: {
      itemSelectedColor: "#005EA8",
      inkBarColor: "#005EA8"
    },
    Tag: {
      borderRadiusSM: 3,
      defaultBg: "#F7F9FA",
      defaultColor: "#1B1B1B"
    }
  }
};
