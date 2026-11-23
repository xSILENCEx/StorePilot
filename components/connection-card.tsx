"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { ChevronRight, KeyRound, Sparkles } from "lucide-react";
import type { ConfigScope } from "../lib/config-model";
import {
  definitions,
  settingsUrl,
  type App,
  type Verification,
} from "./connection-fields";
import { ConfigForm } from "./connection-form";
type Summary = {
  configured: boolean;
  fields: Record<string, unknown>;
  verification: Verification | null;
};
export function ConnectionCard({
  scope,
  app,
}: {
  scope: ConfigScope;
  app?: App;
}) {
  const [state, setState] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [version, setVersion] = useState(0);
  const endpoint = settingsUrl(scope, app);
  const refreshing = ["queued", "running"].includes(
    state?.verification?.status ?? "",
  );
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const r = await fetch(endpoint, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (!controller.signal.aborted) {
          setState(data);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "读取失败");
      }
    };
    void load();
    const timer = refreshing ? setInterval(() => void load(), 2000) : undefined;
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [endpoint, version, refreshing]);
  const reload = useCallback(() => setVersion((current) => current + 1), []);
  const def = definitions[scope];
  const isModel = scope === "text" || scope === "image";
  const status = state?.verification?.status;
  return (
    <>
      <Paper p="xl">
        <Stack gap="lg">
          <Group justify="space-between">
            <ThemeIcon
              variant="light"
              color={isModel ? "blue" : "gray"}
              size={42}
              radius="md"
            >
              {isModel ? <Sparkles size={21} /> : <KeyRound size={21} />}
            </ThemeIcon>
            <Badge
              color={
                !state?.configured
                  ? "gray"
                  : status === "passed"
                    ? "green"
                    : status === "failed" || status === "uncertain"
                      ? "orange"
                      : "blue"
              }
              variant="light"
            >
              {!state
                ? error
                  ? "读取失败"
                  : "读取中"
                : !state.configured
                  ? "未配置"
                  : status === "passed"
                    ? "连接正常"
                    : status === "partial"
                      ? "部分验证通过"
                      : status === "failed"
                        ? "验证失败"
                        : status === "uncertain"
                          ? "结果未知"
                          : status === "queued" || status === "running"
                            ? "验证中"
                            : "已配置"}
            </Badge>
          </Group>
          <div>
            <Title order={3} size="h4">
              {def.title}
            </Title>
            <Text size="sm" c="dimmed" mt={7} lineClamp={1}>
              {error ||
                String(
                  isModel
                    ? state?.fields.model || "连接你的模型服务"
                    : scope === "apple"
                      ? state?.fields.bundleId ||
                        app?.apple ||
                        "填写 App Store Connect 凭据"
                      : state?.fields.packageName ||
                        app?.google ||
                        "填写 Google Play 服务账号",
                )}
            </Text>
          </div>
          <Button
            variant="default"
            rightSection={<ChevronRight size={15} />}
            justify="space-between"
            onClick={() => {
              setDiscard(false);
              setOpened(true);
            }}
          >
            管理配置
          </Button>
        </Stack>
      </Paper>
      <Modal
        opened={opened}
        onClose={() => {
          if (dirty) setDiscard(true);
          else setOpened(false);
        }}
        closeOnClickOutside={false}
        title={def.title}
        size="700px"
      >
        {discard && (
          <Alert color="orange" title="有未保存的修改" mb="lg">
            <Text size="sm">继续编辑，或丢弃修改后关闭。</Text>
            <Group mt="sm">
              <Button
                size="xs"
                variant="default"
                onClick={() => setDiscard(false)}
              >
                继续编辑
              </Button>
              <Button
                size="xs"
                color="orange"
                onClick={() => {
                  setOpened(false);
                  setDirty(false);
                  setDiscard(false);
                }}
              >
                丢弃并关闭
              </Button>
            </Group>
          </Alert>
        )}
        {opened && (
          <ConfigForm
            key={`${scope}:${app?.id ?? "global"}`}
            scope={scope}
            app={app}
            onDirty={setDirty}
            onSaved={reload}
          />
        )}
      </Modal>
    </>
  );
}
