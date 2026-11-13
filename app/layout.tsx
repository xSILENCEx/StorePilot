import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "StorePilot",
  description: "应用商店资料工作台",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
