"use client";
import { screenshotGroup } from "../lib/screenshot-groups";
import { LanguageChecklist } from "./language-checklist";
import { snapshotIdentity, canImportLocale } from "../lib/apple-sync-model";
import { readApiResponse } from "../lib/api-response";
import { isJobActive } from "../lib/job-status";
import { poll } from "../lib/poll";
import { ImagePreview } from "./image-preview";
import { StoreGraphics, StoreScreenshots } from "./store-snapshot-media";
import { WorkspaceLink } from "./workspace-shell";
import { useEffect, useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Drawer,
  Group,
  Modal,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { CloudDownload } from "lucide-react";
import { graphicLabels, type GraphicType } from "../lib/model";
import type { StoreApp, Platform } from "../lib/model";
import {
  type ImportSection,
  textDiff,
  type AppleScreenshot,
  type AppleSnapshot,
  type GoogleSnapshot,
} from "../lib/apple-sync-model";
import { StoreAppDetails, StoreMetadata } from "./store-snapshot-details";
type State = {
  snapshot: AppleSnapshot | GoogleSnapshot | null;
  stale: boolean;
  job: { status: string; result?: { error?: string; message?: string } } | null;
};
export function StoreSyncPanel({
  app,
  platform,
  locale,
  enabled,
  onImport,
  onCatalog,
  onPrimary,
}: {
  app: StoreApp;
  platform: Platform;
  locale: string;
  enabled: boolean;
  onPrimary: (value: { scope: string; locale?: string }) => void;
  onCatalog: (catalog: AppleSnapshot["deviceGroups"]) => void;
  onImport: (
    snapshot: AppleSnapshot | GoogleSnapshot,
    section: ImportSection,
    locales: string[],
  ) => boolean;
}) {
  const apple = platform === "apple";
  const store = apple ? "Apple" : "Google Play";
  const endpoint = `/api/${platform}-sync`;
  const [opened, setOpened] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [appInfoId, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeLocale, setActiveLocale] = useState(locale);
  const [tab, setTab] = useState<string | null>("metadata");
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<string[] | null>(null);
  useEffect(() => {
    if (selection === null) setQuery("");
  }, [selection]);
  const [preview, setPreview] = useState<AppleScreenshot | null>(null);
  useEffect(() => {
    const refresh = async (signal: AbortSignal) => {
      try {
        const r = await fetch(`${endpoint}?appId=${app.id}`, {
          cache: "no-store",
          signal,
        });
        const data = await readApiResponse(r);
        if (!signal.aborted) {
          setState(data);
          const identity = data.snapshot && snapshotIdentity(data.snapshot);
          onPrimary({
            scope: JSON.stringify([app.id, platform, app[platform]]),
            locale:
              identity?.identifier === app[platform]
                ? identity.primary
                : undefined,
          });
          if (apple)
            onCatalog(data.stale ? undefined : data.snapshot?.deviceGroups);
        }
      } catch (e) {
        if (!signal.aborted)
          setError(e instanceof Error ? e.message : "读取商店资料失败");
      }
    };
    return poll(refresh, opened ? 3000 : null);
  }, [
    app.id,
    app.apple,
    app.google,
    platform,
    opened,
    onCatalog,
    onPrimary,
    endpoint,
    apple,
  ]);
  const pending = busy || isJobActive(state?.job?.status);
  const snapshot = state?.snapshot;
  const groupLabel = (device: string) =>
    screenshotGroup(
      platform,
      device,
      snapshot && "target" in snapshot ? snapshot.deviceGroups : undefined,
    ).label;
  const section = tab as ImportSection;
  const sectionLabel = {
    metadata: "文案",
    screenshots: "截图",
    graphics: "图片资源",
  }[section];
  const primary = snapshot && snapshotIdentity(snapshot).primary;
  const eligible = snapshot
    ? Object.keys(snapshot.locales).filter((language) =>
        canImportLocale(snapshot, language, platform, section),
      )
    : [];
  const selectedLocale = snapshot?.locales[activeLocale]
    ? activeLocale
    : Object.keys(snapshot?.locales ?? {})[0];
  const entry = snapshot?.locales[selectedLocale];
  const local = app.drafts[`${platform}:${selectedLocale}`];
  const differences = entry ? textDiff(local, entry.draft, platform) : [];
  const screenshotCount = Object.values(snapshot?.locales ?? {}).reduce(
    (count, value) => count + (value.screenshots?.length ?? 0),
    0,
  );
  async function sync() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          apple ? { appId: app.id, appInfoId } : { appId: app.id },
        ),
      });
      const data = await readApiResponse(r);
      setState((s) => s && { ...s, job: { status: "queued" } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="default"
        leftSection={<CloudDownload size={15} />}
        onClick={() => {
          setActiveLocale(locale);
          setOpened(true);
        }}
      >
        商店资料
      </Button>
      <Drawer
        opened={opened && !preview && selection === null}
        onClose={() => setOpened(false)}
        position="right"
        title={store + " 商店资料"}
        size="xl"
        styles={{ content: { scrollbarGutter: "stable" } }}
        closeButtonProps={{ "aria-label": "关闭商店资料" }}
      >
        <Stack gap="lg">
          <Text size="sm" c="dimmed">
            同步 {store}
            的元数据与截图，查看差异并选择导入。现有草稿不会自动覆盖。
          </Text>
          {!apple && (
            <Text size="sm" c="dimmed">
              同步将创建临时 Google Play
              edit。请避开同一服务账号对该应用的其他编辑任务，以免使进行中的
              edit 失效。
            </Text>
          )}
          {!enabled && (
            <Alert color="orange">
              请先保存草稿并完成{" "}
              <WorkspaceLink href={`/settings?appId=${app.id}`}>
                {store} 连接配置
              </WorkspaceLink>
              。
            </Alert>
          )}
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="space-between">
            <div>
              <Text size="sm" fw={550}>
                {snapshot
                  ? "packageName" in snapshot
                    ? snapshot.packageName
                    : `${snapshot.target.platform} · ${snapshot.target.version}`
                  : "尚未同步商店资料"}
              </Text>
              <Text size="xs" c="dimmed" mt={4}>
                {snapshot
                  ? `${Object.keys(snapshot.locales).length} 种语言 · ${screenshotCount} 张截图 · ${new Date(snapshot.fetchedAt).toLocaleString()}`
                  : !apple
                    ? "读取当前 Google Play 主商店详情。"
                    : "未指定版本时，优先读取已上架版本，否则读取最新版本。"}
              </Text>
            </div>
            <Button
              loading={pending}
              disabled={!enabled || !state}
              leftSection={<CloudDownload size={15} />}
              onClick={() => void sync()}
            >
              {snapshot ? "重新同步" : "同步商店资料"}
            </Button>
          </Group>
          {apple && (
            <Accordion variant="default">
              <Accordion.Item value="advanced">
                <Accordion.Control>高级选项</Accordion.Control>
                <Accordion.Panel>
                  <TextInput
                    label="应用资料 ID（可选）"
                    description="自动匹配所选版本的资料。仅在无法唯一确定时填写。"
                    value={appInfoId}
                    onChange={(e) => setInfo(e.currentTarget.value)}
                  />
                  <Text size="xs" c="dimmed" mt="sm">
                    如需读取指定版本，可在 Apple 连接配置中填写目标版本号。
                  </Text>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          )}
          {(state?.job?.status === "failed" ||
            state?.job?.status === "uncertain") && (
            <Alert color="red">{state.job.result?.error ?? "同步失败"}</Alert>
          )}
          {pending && (
            <Text size="sm" c="dimmed" role="status">
              正在后台同步元数据和截图，可以关闭侧栏稍后查看。
            </Text>
          )}
          {snapshot && (
            <>
              {state?.stale && (
                <Alert color="orange">
                  连接配置已改变，请重新同步后再导入。
                </Alert>
              )}
              {snapshot.warnings?.map((warning, i) => (
                <Alert key={i} color="orange">
                  {warning}
                </Alert>
              ))}
              <Tabs value={tab} onChange={setTab}>
                <Tabs.List>
                  <Tabs.Tab value="metadata">本地化元数据</Tabs.Tab>
                  <Tabs.Tab value="screenshots">
                    商店截图{" "}
                    <Badge size="xs" color="gray" ml={5}>
                      {screenshotCount}
                    </Badge>
                  </Tabs.Tab>
                  {!apple && <Tabs.Tab value="graphics">商店图片资源</Tabs.Tab>}
                  <Tabs.Tab value="app">应用信息</Tabs.Tab>
                </Tabs.List>
                {(tab === "metadata" ||
                  tab === "screenshots" ||
                  tab === "graphics") && (
                  <Group justify="space-between" mt="lg">
                    <Select
                      aria-label="选择商店资料语言"
                      value={selectedLocale ?? null}
                      data={Object.keys(snapshot.locales)}
                      onChange={(value) => value && setActiveLocale(value)}
                      w={180}
                    />
                    <Button
                      size="xs"
                      disabled={
                        !enabled || pending || state?.stale || !eligible.length
                      }
                      onClick={() =>
                        setSelection(
                          primary && eligible.includes(primary)
                            ? [primary]
                            : [],
                        )
                      }
                    >
                      选择语言并覆盖{sectionLabel}
                    </Button>
                  </Group>
                )}
                <StoreMetadata
                  entry={entry}
                  selectedLocale={selectedLocale}
                  local={local}
                  apple={apple}
                  differences={differences}
                />
                <StoreScreenshots
                  appId={app.id}
                  platform={platform}
                  locale={selectedLocale}
                  onPreview={setPreview}
                  screenshots={entry?.screenshots ?? []}
                  groupLabel={groupLabel}
                />
                {"packageName" in snapshot && (
                  <StoreGraphics
                    appId={app.id}
                    platform={platform}
                    locale={selectedLocale}
                    onPreview={setPreview}
                    graphics={snapshot.locales[selectedLocale]?.graphics}
                  />
                )}
                <StoreAppDetails snapshot={snapshot} />
              </Tabs>
            </>
          )}
        </Stack>
      </Drawer>
      <Modal
        opened={opened && selection !== null}
        onClose={() => setSelection(null)}
        title={`选择覆盖${sectionLabel}的语言`}
      >
        <Stack>
          <Text size="sm">
            {section === "screenshots"
              ? "所选语言的全部草稿截图将替换为商店截图，包括未分组截图。仅列出截图已全部下载的语言。"
              : section === "graphics"
                ? "所选语言的图片资源将替换为商店图片资源。"
                : "将覆盖所选语言的商店文案字段，缺少的语言将创建草稿。"}
          </Text>
          <LanguageChecklist
            options={eligible}
            targets={selection ?? []}
            setTargets={setSelection}
            query={query}
            setQuery={setQuery}
            primary={primary ?? undefined}
          />

          <Group justify="flex-end">
            <Button variant="default" onClick={() => setSelection(null)}>
              取消
            </Button>
            <Button
              disabled={
                !selection?.length ||
                !enabled ||
                pending ||
                state?.stale ||
                !selection.every((language) => eligible.includes(language))
              }
              onClick={() => {
                if (
                  snapshot &&
                  selection?.length &&
                  onImport(snapshot, section, selection)
                ) {
                  notifications.show({
                    message: `已更新 ${selection.length} 种语言的${sectionLabel}草稿`,
                  });
                  setSelection(null);
                }
              }}
            >
              确认覆盖（{selection?.length ?? 0}）
            </Button>
          </Group>
        </Stack>
      </Modal>
      <ImagePreview
        src={opened ? preview?.url : null}
        alt="商店图片"
        title="商店图片预览"
        onClose={() => setPreview(null)}
        backLabel="返回商店资料"
        downloadName={preview?.fileName || "store-screenshot.png"}
        caption={
          preview && (
            <Text size="xs" c="dimmed">
              {graphicLabels[preview.deviceType as GraphicType] ??
                groupLabel(preview.deviceType)}{" "}
              · {preview.width} × {preview.height}
            </Text>
          )
        }
      />
    </>
  );
}
