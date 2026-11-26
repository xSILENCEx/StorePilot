"use client";
import { ImageReviewActions } from "./image-review-actions";
import type { ImageReview } from "../lib/image-resolution";
import { readApiResponse } from "../lib/api-response";
import { poll } from "../lib/poll";
import { useEffect, useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Drawer,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
type Task = {
  id: string;
  app_id: string;
  kind: string;
  platform: string;
  status: string;
  result: Record<string, unknown> | null;
  languages?: string;
  logs: { step: string; message: string }[];
};
const statuses: Record<string, string> = {
  paused: "待确认尺寸",
  cancelled: "已停止",
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  uncertain: "结果未知",
};
const statusColors: Record<string, string> = {
  queued: "gray",
  running: "blue",
  succeeded: "green",
  failed: "orange",
  uncertain: "orange",
};
const kinds: Record<string, string> = {
  translate: "草稿翻译",
  generate_image: "图片生成",
  push_store: "商店资料推送",
  pull_google: "Google Play 商店资料同步",
  pull_apple: "Apple 商店资料同步",
  verify_connection: "连接验证",
  validate_draft: "草稿校验",
};
export function TaskDrawer({
  opened,
  onClose,
  appId,
}: {
  opened: boolean;
  onClose: () => void;
  appId?: string;
}) {
  const [jobs, setJobs] = useState<Task[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!opened) return;
    setReady(false);
    setJobs([]);
    setError("");
    const load = async (signal: AbortSignal) => {
      try {
        const r = await fetch(
          appId ? "/api/jobs?appId=" + encodeURIComponent(appId) : "/api/jobs",
          { cache: "no-store", signal },
        );
        const data = await readApiResponse(r);
        if (!signal.aborted) {
          setJobs(data.jobs);
          setReady(true);
          setError("");
        }
      } catch (e) {
        if (!signal.aborted)
          setError(e instanceof Error ? e.message : "读取失败");
      }
    };
    return poll(load, 3000);
  }, [opened, appId]);

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title="任务记录"
      position="right"
      size="lg"
      styles={{ content: { scrollbarGutter: "stable" } }}
      closeButtonProps={{ "aria-label": "关闭任务记录" }}
    >
      <Stack>
        <Text size="sm" c="dimmed">
          关闭页面后任务继续运行，这里每 3 秒刷新。
        </Text>
        {error && <Alert color="red">{error}</Alert>}
        {!ready && !error && <Loader size="sm" />}
        {ready && !jobs.length && (
          <Text c="dimmed" ta="center" py="xl">
            暂无任务记录
          </Text>
        )}
        <Accordion variant="separated">
          {jobs.map((j) => (
            <Accordion.Item value={j.id} key={j.id}>
              <Accordion.Control>
                <Group justify="space-between" pr="sm">
                  <Text size="sm" fw={500}>
                    {kinds[j.kind] ?? j.kind}
                    {j.languages && " · " + j.languages}
                  </Text>
                  <Badge
                    color={statusColors[j.status] ?? "gray"}
                    variant="light"
                  >
                    {statuses[j.status] ?? j.status}
                  </Badge>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="xs">
                  {j.logs.map((log, i) => (
                    <Text size="sm" key={i}>
                      {log.message}
                    </Text>
                  ))}
                  {typeof j.result?.error === "string" && (
                    <Alert color="orange">{j.result.error}</Alert>
                  )}
                  {j.status === "paused" && !!j.result?.review && (
                    <ImageReviewActions
                      key={(j.result.review as ImageReview).token}
                      id={j.id}
                      review={j.result.review as ImageReview}
                    />
                  )}
                  {Array.isArray(j.result?.errors) && (
                    <Text size="sm">
                      {j.result.errors.length
                        ? j.result.errors.join("；")
                        : "校验完成，未发现字段长度问题"}
                    </Text>
                  )}
                  {j.status === "failed" && j.kind === "validate_draft" && (
                    <Button
                      size="xs"
                      variant="light"
                      onClick={async () => {
                        try {
                          const r = await fetch(
                            appId
                              ? "/api/jobs?appId=" + encodeURIComponent(appId)
                              : "/api/jobs",
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ retryId: j.id }),
                            },
                          );
                          const data = await readApiResponse(r);
                          notifications.show({ message: "已重新提交校验任务" });
                        } catch (e) {
                          notifications.show({
                            color: "red",
                            message:
                              e instanceof Error ? e.message : "重试失败",
                          });
                        }
                      }}
                    >
                      重试校验
                    </Button>
                  )}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </Stack>
    </Drawer>
  );
}
