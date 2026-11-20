"use client";
import { useState } from "react";
import { Button } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Download } from "lucide-react";
import type { Platform } from "../lib/model";

export function BatchDownload({ size = "xs", ...props }: {
  size?: "xs" | "sm";
  appId: string;
  platform: Platform;
  locale: string;
  group: string;
  items: { url: string; label?: string }[];
}) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const response = await fetch("/api/assets/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(props),
      });
      if (!response.ok)
        throw new Error((await response.json()).error || "图片下载失败");
      const name = response.headers
        .get("content-disposition")
        ?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name ? decodeURIComponent(name) : "图片.zip";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      notifications.show({
        color: "red",
        message: e instanceof Error ? e.message : "图片下载失败",
      });
    } finally {
      setBusy(false);
    }
  }
  if (!props.items.length) return null;
  return (
    <Button
      variant="default"
      size={size}
      loading={busy}
      leftSection={<Download size={15} />}
      onClick={() => void download()}
    >
      批量下载（{props.items.length}）
    </Button>
  );
}
