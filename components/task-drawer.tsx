"use client";
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
  logs: { step: string; message: string }[];
};
const statuses: Record<string, string> = {
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  uncertain: "结果未知",
};
const kinds: Record<string, string> = {
  generate_image: "图片生成",
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
    let active = true;
    const load = async () => {
      try {
        const r = await fetch("/api/jobs", { cache: "no-store" });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (active) {
          setJobs(data.jobs);
          setReady(true);
          setError("");
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "读取失败");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [opened]);
  const filtered = jobs.filter((j) => !appId || j.app_id === appId);
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title="任务记录"
      position="right"
      size="lg"
      closeButtonProps={{ "aria-label": "关闭任务记录" }}
    >
      <Stack>
        <Text size="sm" c="dimmed">
          关闭页面后任务继续运行，这里每 3 秒刷新。
        </Text>
        {error && <Alert color="red">{error}</Alert>}
        {!ready && !error && <Loader size="sm" />}
        {ready && !filtered.length && (
          <Text c="dimmed" ta="center" py="xl">
            暂无任务记录
          </Text>
        )}
        <Accordion variant="separated">
          {filtered.map((j) => (
            <Accordion.Item value={j.id} key={j.id}>
              <Accordion.Control>
                <Group justify="space-between" pr="sm">
                  <Text size="sm" fw={500}>
                    {kinds[j.kind] ?? j.kind}
                  </Text>
                  <Badge
                    color={
                      j.status === "failed" || j.status === "uncertain"
                        ? "orange"
                        : j.status === "succeeded"
                          ? "green"
                          : "blue"
                    }
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
                          const r = await fetch("/api/jobs", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ retryId: j.id }),
                          });
                          const data = await r.json();
                          if (!r.ok) throw new Error(data.error);
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
