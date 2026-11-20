"use client";
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
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { CloudDownload, Download, ImagePlus } from "lucide-react";
import { deviceGroups } from "../lib/screenshot-groups";
import type { Draft, StoreApp, Platform } from "../lib/model";
import {
  appleDeviceLabel,
  importMissing,
  textDiff,
  type AppleScreenshot,
  type AppleSnapshot,
  type GoogleSnapshot,
} from "../lib/apple-sync-model";
type State = {
  snapshot: AppleSnapshot | GoogleSnapshot | null;
  previous: AppleSnapshot | GoogleSnapshot | null;
  stale: boolean;
  job: { status: string; result?: { error?: string; message?: string } } | null;
};
const labels: Record<string, string> = {
  title: "应用名称",
  subtitle: "副标题",
  description: "描述",
  keywords: "关键词",
  promotionalText: "推广文本",
  whatsNew: "版本更新说明",
  supportUrl: "支持网址",
  marketingUrl: "营销网址",
  privacyPolicyUrl: "隐私政策网址",
  privacyChoicesUrl: "隐私选择网址",
};
export function StoreSyncPanel({
  app,
  platform,
  locale,
  enabled,
  onImport,
  onImportScreenshots,
  onImportLocale,
  onCatalog,
}: {
  app: StoreApp;
  platform: Platform;
  locale: string;
  enabled: boolean;
  onCatalog: (catalog: AppleSnapshot["deviceGroups"]) => void;
  onImport: (snapshot: AppleSnapshot | GoogleSnapshot) => void;
  onImportLocale: (locale: string, draft: Draft) => boolean;
  onImportScreenshots: (
    locale: string,
    draft: Draft,
    images: AppleScreenshot[],
  ) => boolean;
}) {
  const apple = platform === "apple";
  const store = apple ? "Apple" : "Google Play";
  const endpoint = `/api/${platform}-sync`;
  const groupLabel = (device: string) =>
    apple
      ? appleDeviceLabel(device)
      : deviceGroups("google", [device]).find(
          (group) => group.value === device,
        )!.label;
  const [opened, setOpened] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [appInfoId, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeLocale, setActiveLocale] = useState(locale);
  const [tab, setTab] = useState<string | null>("metadata");
  const [confirmImport, setConfirmImport] = useState(false);
  const [preview, setPreview] = useState<AppleScreenshot | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const r = await fetch(`${endpoint}?appId=${app.id}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (!controller.signal.aborted) {
          setState(data);
          if (apple)
            onCatalog(data.stale ? undefined : data.snapshot?.deviceGroups);
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "读取商店资料失败");
      }
    };
    void refresh();
    const timer = opened ? setInterval(() => void refresh(), 3000) : undefined;
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [app.id, opened, onCatalog, endpoint, apple]);
  const pending =
    busy || ["queued", "running"].includes(state?.job?.status ?? "");
  const snapshot = state?.snapshot;
  const missing = snapshot
    ? Object.keys(importMissing(app.drafts, snapshot, platform)).length -
      Object.keys(app.drafts).length
    : 0;
  const selectedLocale = snapshot?.locales[activeLocale]
    ? activeLocale
    : Object.keys(snapshot?.locales ?? {})[0];
  const entry = snapshot?.locales[selectedLocale];
  const local = app.drafts[`${platform}:${selectedLocale}`];
  const differences = entry ? textDiff(local, entry.draft, platform) : [];
  const previous = state?.previous?.locales[selectedLocale]?.draft;
  const groups = Object.groupBy(
    entry?.screenshots ?? [],
    (image) => image.deviceType,
  );
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
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
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
        opened={opened && !preview}
        onClose={() => setOpened(false)}
        position="right"
        title={store + " 商店资料"}
        size="xl"
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
              <a href={`/settings?appId=${app.id}`}>{store} 连接配置</a>。
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
                  <Tabs.Tab value="app">应用信息</Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="metadata" pt="lg">
                  <Stack gap="lg">
                    <Group justify="space-between">
                      <Select
                        aria-label="元数据语言"
                        value={selectedLocale ?? null}
                        data={Object.keys(snapshot.locales)}
                        onChange={(value) =>
                          value &&
                          (setActiveLocale(value), setConfirmImport(false))
                        }
                        w={180}
                      />
                      <Button
                        size="xs"
                        variant="light"
                        disabled={
                          !enabled || pending || state?.stale || !missing
                        }
                        onClick={() => {
                          onImport(snapshot);
                          notifications.show({
                            message: `已补充 ${missing} 种语言的元数据。截图可在商店截图页按设备组导入。`,
                          });
                        }}
                      >
                        补充缺少的 {missing} 种语言
                      </Button>
                    </Group>
                    {entry && (
                      <>
                        <Group justify="space-between">
                          <Text size="sm" fw={550}>
                            {selectedLocale} 商店元数据
                          </Text>
                          <Button
                            size="xs"
                            variant="light"
                            disabled={
                              !enabled ||
                              pending ||
                              state?.stale ||
                              !differences.length
                            }
                            onClick={() => setConfirmImport(true)}
                          >
                            导入当前语言
                          </Button>
                        </Group>
                        {confirmImport && (
                          <Alert
                            color="orange"
                            title="使用商店元数据更新当前语言？"
                          >
                            <Text size="sm">
                              将替换此语言的文案和网址，已有本地截图保留。
                            </Text>
                            <Group mt="sm">
                              <Button
                                size="xs"
                                onClick={() => {
                                  if (
                                    onImportLocale(selectedLocale, entry.draft)
                                  ) {
                                    setConfirmImport(false);
                                    notifications.show({
                                      message: `已导入 ${selectedLocale} 的商店元数据，本地截图保留。`,
                                    });
                                  }
                                }}
                              >
                                确认导入
                              </Button>
                              <Button
                                size="xs"
                                variant="default"
                                onClick={() => setConfirmImport(false)}
                              >
                                取消
                              </Button>
                            </Group>
                          </Alert>
                        )}
                        <Text size="xs" c="dimmed">
                          {!local
                            ? "此语言尚无本地草稿。"
                            : differences.length
                              ? `${differences.length} 个字段与本地不同。`
                              : "与本地元数据一致。"}
                        </Text>
                        <Accordion variant="separated">
                          {Object.entries(
                            apple
                              ? labels
                              : {
                                  title: "应用名称",
                                  subtitle: "简短描述",
                                  description: "完整描述",
                                  video: "宣传视频网址",
                                },
                          ).map(([field, label]) => {
                            const key = field as keyof Omit<
                              Draft,
                              "images" | "screenshotGroups"
                            >;
                            const remote = entry.draft[key] ?? "";
                            return (
                              <Accordion.Item key={field} value={field}>
                                <Accordion.Control>
                                  <Group justify="space-between" pr="sm">
                                    <Text size="sm">{label}</Text>
                                    {differences.includes(key) && (
                                      <Badge
                                        size="xs"
                                        color="orange"
                                        variant="light"
                                      >
                                        不同
                                      </Badge>
                                    )}
                                  </Group>
                                </Accordion.Control>
                                <Accordion.Panel>
                                  <SimpleGrid
                                    cols={{ base: 1, sm: previous ? 3 : 2 }}
                                  >
                                    <div>
                                      <Text size="xs" c="dimmed">
                                        本地草稿
                                      </Text>
                                      <p className="diff-copy">
                                        {local?.[key] || "（空）"}
                                      </p>
                                    </div>
                                    <div>
                                      <Text size="xs" c="blue.7">
                                        最新商店资料
                                      </Text>
                                      <p className="diff-copy">
                                        {remote || "（空）"}
                                      </p>
                                    </div>
                                    {previous && (
                                      <div>
                                        <Text size="xs" c="dimmed">
                                          上次商店资料
                                        </Text>
                                        <p className="diff-copy">
                                          {previous[key] || "（空）"}
                                        </p>
                                      </div>
                                    )}
                                  </SimpleGrid>
                                </Accordion.Panel>
                              </Accordion.Item>
                            );
                          })}
                        </Accordion>
                      </>
                    )}
                  </Stack>
                </Tabs.Panel>
                <Tabs.Panel value="screenshots" pt="lg">
                  <Stack gap="lg">
                    <Select
                      label="截图语言"
                      value={selectedLocale ?? null}
                      data={Object.keys(snapshot.locales)}
                      onChange={(value) =>
                        value &&
                        (setActiveLocale(value), setConfirmImport(false))
                      }
                      w={200}
                    />
                    {!entry?.screenshots?.length ? (
                      <Text size="sm" c="dimmed" ta="center" py="xl">
                        此语言暂无商店截图。
                      </Text>
                    ) : (
                      Object.entries(groups).map(([device, images]) => {
                        const shots = images ?? [];
                        const available = shots.filter((image) => image.url);
                        const allAdded =
                          available.length > 0 &&
                          available.every((image) =>
                            local?.screenshotGroups?.[device]?.includes(
                              image.url!,
                            ),
                          );
                        return (
                          <PaperGroup key={device}>
                            <Group justify="space-between" mb="md">
                              <div>
                                <Text size="sm" fw={550}>
                                  {groupLabel(device)}
                                </Text>
                                <Text size="xs" c="dimmed">
                                  {shots.length} 张 · {shots[0]?.width} ×{" "}
                                  {shots[0]?.height}
                                </Text>
                              </div>
                              <Button
                                size="xs"
                                variant="light"
                                disabled={
                                  !enabled ||
                                  pending ||
                                  state?.stale ||
                                  !available.length ||
                                  allAdded
                                }
                                onClick={() => {
                                  if (
                                    onImportScreenshots(
                                      selectedLocale,
                                      entry!.draft,
                                      available,
                                    )
                                  )
                                    notifications.show({
                                      message: `已将 ${available.length} 张截图加入 ${selectedLocale} 的本地草稿。`,
                                    });
                                }}
                              >
                                {allAdded ? "已加入截图" : "将此组加入本地截图"}
                              </Button>
                            </Group>
                            <SimpleGrid cols={{ base: 2, sm: 3 }}>
                              {shots.map((image) => (
                                <div key={image.id}>
                                  {image.url ? (
                                    <button
                                      type="button"
                                      className="preview-button"
                                      aria-label="预览商店截图"
                                      onClick={() => setPreview(image)}
                                    >
                                      <img
                                        className="generated-image"
                                        src={image.url}
                                        alt={`${groupLabel(device)} 商店截图`}
                                        loading="lazy"
                                      />
                                    </button>
                                  ) : (
                                    <Text size="xs" c="dimmed" py="xl">
                                      图片尚未处理完成
                                    </Text>
                                  )}
                                </div>
                              ))}
                            </SimpleGrid>
                          </PaperGroup>
                        );
                      })
                    )}
                    <Text size="xs" c="dimmed">
                      保持商店展示顺序，按语言与设备分组。导入只追加截图，不删除已有图片。
                    </Text>
                  </Stack>
                </Tabs.Panel>
                <Tabs.Panel value="app" pt="lg">
                  <Stack>
                    {Object.entries(
                      "packageName" in snapshot
                        ? { 包名: snapshot.packageName }
                        : {
                            应用名称: snapshot.metadata?.name,
                            主要语言: snapshot.metadata?.primaryLocale,
                            SKU: snapshot.metadata?.sku,
                            版本: snapshot.target.version,
                            平台: snapshot.target.platform,
                            版本状态: snapshot.target.versionState,
                            版权: snapshot.metadata?.copyright,
                            发布方式: snapshot.metadata?.releaseType,
                            最早发布日期:
                              snapshot.metadata?.earliestReleaseDate,
                            主要分类: snapshot.metadata?.primaryCategoryId,
                            次要分类: snapshot.metadata?.secondaryCategoryId,
                            年龄分级: snapshot.metadata?.ageRating,
                          },
                    ).map(([label, value]) => (
                      <Group key={label} justify="space-between" align="start">
                        <Text size="sm" c="dimmed">
                          {label}
                        </Text>
                        <Text
                          size="sm"
                          maw="65%"
                          style={{ overflowWrap: "anywhere" }}
                        >
                          {value || "—"}
                        </Text>
                      </Group>
                    ))}
                  </Stack>
                </Tabs.Panel>
              </Tabs>
            </>
          )}
        </Stack>
      </Drawer>
      <Modal
        opened={opened && !!preview}
        onClose={() => setPreview(null)}
        title="商店截图预览"
        size="850px"
      >
        {preview?.url && (
          <Stack>
            <img className="image-preview" src={preview.url} alt="商店截图" />
            <Text size="xs" c="dimmed">
              {groupLabel(preview.deviceType)} · {preview.width} ×{" "}
              {preview.height}
            </Text>
            <Group justify="space-between">
              <Button variant="default" onClick={() => setPreview(null)}>
                返回商店资料
              </Button>
              <Button
                component="a"
                href={preview.url}
                download={preview.fileName || "store-screenshot.png"}
                leftSection={<Download size={15} />}
              >
                下载截图
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
function PaperGroup({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: 10,
        padding: 16,
      }}
    >
      {children}
    </div>
  );
}
