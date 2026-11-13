"use client";
import {
  createTheme,
  MantineProvider,
  Button,
  Modal,
  Paper,
  TextInput,
  Textarea,
  PasswordInput,
  Select,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
const theme = createTheme({
  primaryColor: "teal",
  defaultRadius: "md",
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
  headings: { fontFamily: "inherit", fontWeight: "650" },
  colors: {
    teal: [
      "#effaf5",
      "#d9f1e5",
      "#b1e0ca",
      "#85cfad",
      "#60bd95",
      "#43ad81",
      "#218260",
      "#196c50",
      "#145740",
      "#104734",
    ],
  },
  components: {
    Button: Button.extend({ defaultProps: { fw: 550 } }),
    Modal: Modal.extend({
      defaultProps: {
        centered: true,
        overlayProps: { backgroundOpacity: 0.3, blur: 3 },
        closeButtonProps: { "aria-label": "关闭弹窗" },
      },
    }),
    Paper: Paper.extend({ defaultProps: { withBorder: true } }),
    TextInput: TextInput.extend({ defaultProps: { size: "md" } }),
    Textarea: Textarea.extend({ defaultProps: { size: "md" } }),
    PasswordInput: PasswordInput.extend({ defaultProps: { size: "md" } }),
    Select: Select.extend({
      defaultProps: { size: "md", allowDeselect: false },
    }),
  },
});
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider theme={theme} forceColorScheme="light">
      <Notifications position="top-right" />
      {children}
    </MantineProvider>
  );
}
