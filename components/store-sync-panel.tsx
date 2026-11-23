"use client";
import { BatchDownload } from "./batch-download";
import { useEffect, useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Checkbox,
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
import { CloudDownload, Download } from "lucide-react";
import { deviceGroups } from "../lib/screenshot-groups";
import { graphicTypes, graphicLabels, type GraphicType } from "../lib/model";
import type { Draft, StoreApp, Platform } from "../lib/model";
import {
  appleDeviceLabel,
  type ImportSection,
  type StoreLocales,
  textDiff,
  type AppleScreenshot,
  type AppleSnapshot,
  type GoogleSnapshot,
} from "../lib/apple-sync-model";
type State = {
  snapshot: AppleSnapshot | GoogleSnapshot | null;
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
  const [selection, setSelection] = useState<string[] | null>(null);
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
          const identifier = apple
            ? data.snapshot?.target?.bundleId
            : data.snapshot?.packageName;
          onPrimary({
            scope: JSON.stringify([app.id, platform, app[platform]]),
            locale:
              identifier === app[platform]
                ? apple
                  ? data.snapshot?.metadata?.primaryLocale
                  : data.snapshot?.details?.defaultLanguage
                : undefined,
          });
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
  const pending =
    busy || ["queued", "running"].includes(state?.job?.status ?? "");
  const snapshot = state?.snapshot;
  const section = tab as ImportSection;
  const sectionLabel = {
    metadata: "文案",
    screenshots: "截图",
    graphics: "图片资源",
  }[section];
  const primary =
    snapshot &&
    ("packageName" in snapshot
      ? snapshot.details?.defaultLanguage
      : snapshot.metadata?.primaryLocale);
  const locales: StoreLocales = snapshot?.locales ?? {};
  const eligible = Object.entries(locales)
    .filter(([, item]) => {
      if (section === "screenshots")
        return (
          item.screenshots?.length &&
          item.screenshots.every((image) => image.url) &&
          Object.entries(
            Object.groupBy(item.screenshots, (image) => image.deviceType),
          ).every(
            ([device, images]) =>
              (images?.length ?? 0) <=
              (snapshot && "target" in snapshot
                ? (snapshot.deviceGroups?.find(
                    (group) => group.value === device,
                  )?.limit ?? 10)
                : 8),
          )
        );
      if (section === "graphics")
        return Object.values(item.graphics ?? {}).some((image) => image.url);
      return true;
    })
    .map(([language]) => language);
  const selectedLocale = snapshot?.locales[activeLocale]
    ? activeLocale
    : Object.keys(snapshot?.locales ?? {})[0];
  const entry = snapshot?.locales[selectedLocale];
  const local = app.drafts[`${platform}:${selectedLocale}`];
  const differences = entry ? textDiff(local, entry.draft, platform) : [];
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
                <Tabs.Panel value="metadata" pt="lg">
                  <Stack gap="lg">
                    {entry && (
                      <>
                        <Group justify="space-between">
                          <Text size="sm" fw={550}>
                            {selectedLocale} 商店元数据
                          </Text>
                        </Group>
                        <Text size="xs" c="dimmed">
                          {!local
                            ? "此语言尚无草稿。"
                            : differences.length
                              ? `${differences.length} 个字段与草稿不同。`
                              : "与草稿一致。"}
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
                              "images" | "screenshotGroups" | "graphics"
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
                                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                                    <div>
                                      <Text size="xs" c="dimmed">
                                        草稿
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
                    {!entry?.screenshots?.length ? (
                      <Text size="sm" c="dimmed" ta="center" py="xl">
                        此语言暂无商店截图。
                      </Text>
                    ) : (
                      Object.entries(groups).map(([device, images]) => {
                        const shots = images ?? [];
                        return (
                          <section key={device}>
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
                              <BatchDownload
                                appId={app.id}
                                platform={platform}
                                locale={selectedLocale}
                                group={groupLabel(device) + "商店截图"}
                                items={shots.flatMap((image) =>
                                  image.url ? [{ url: image.url }] : [],
                                )}
                              />
                            </Group>
                            <SimpleGrid
                              cols={{ base: 2, xs: 3, sm: 4 }}
                              spacing="sm"
                              verticalSpacing="sm"
                            >
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
                                        className="store-sync-screenshot"
                                        width={image.width || undefined}
                                        height={image.height || undefined}
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
                          </section>
                        );
                      })
                    )}
                    <Text size="xs" c="dimmed">
                      保持商店展示顺序，按语言与设备分组。
                    </Text>
                  </Stack>
                </Tabs.Panel>
                {"packageName" in snapshot && (
                  <Tabs.Panel value="graphics" pt="lg">
                    <Stack>
                      <Group justify="flex-end">
                        <BatchDownload
                          appId={app.id}
                          platform={platform}
                          locale={selectedLocale}
                          group="商店图片资源"
                          items={graphicTypes.flatMap((type) => {
                            const url =
                              snapshot.locales[selectedLocale]?.graphics?.[type]
                                ?.url;
                            return url
                              ? [{ url, label: graphicLabels[type] }]
                              : [];
                          })}
                        />
                      </Group>
                      {graphicTypes.map((type) => {
                        const image =
                          snapshot.locales[selectedLocale]?.graphics?.[type];
                        return (
                          <Stack key={type} gap="xs">
                            <Group justify="space-between">
                              <Text fw={550}>{graphicLabels[type]}</Text>
                            </Group>
                            {image?.url ? (
                              <button
                                type="button"
                                className="preview-button"
                                style={{
                                  width: "fit-content",
                                  maxWidth: "100%",
                                }}
                                onClick={() => setPreview(image)}
                                aria-label={`预览${graphicLabels[type]}`}
                              >
                                <img
                                  src={image.url}
                                  alt={graphicLabels[type]}
                                  style={{
                                    display: "block",
                                    maxWidth: "100%",
                                    maxHeight: 180,
                                  }}
                                />
                              </button>
                            ) : (
                              <Text size="sm" c="dimmed">
                                {snapshot.locales[selectedLocale]?.graphics
                                  ? "此语言暂无该资源"
                                  : "重新同步后可查看此语言的图片资源"}
                              </Text>
                            )}
                          </Stack>
                        );
                      })}
                    </Stack>
                  </Tabs.Panel>
                )}
                <Tabs.Panel value="app" pt="lg">
                  <Stack>
                    {snapshot.icon?.url && (
                      <Group justify="space-between">
                        <Text size="sm" c="dimmed">
                          应用图标
                        </Text>
                        <img
                          width={64}
                          height={64}
                          style={{ objectFit: "contain" }}
                          src={snapshot.icon.url}
                          alt="商店应用图标"
                        />
                      </Group>
                    )}
                    {"packageName" in snapshot && !snapshot.details && (
                      <Text size="sm" c="dimmed">
                        重新同步商店资料后可查看默认语言和公开联系方式。
                      </Text>
                    )}
                    {Object.entries(
                      "packageName" in snapshot
                        ? {
                            包名: snapshot.packageName,
                            ...(snapshot.details && {
                              应用名称:
                                snapshot.locales[
                                  snapshot.details.defaultLanguage ?? ""
                                ]?.draft.title,
                              默认语言: snapshot.details.defaultLanguage,
                              联系网站: snapshot.details.contactWebsite,
                              支持邮箱: snapshot.details.contactEmail,
                              支持电话: snapshot.details.contactPhone,
                            }),
                          }
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
          <Group>
            <Button variant="subtle" onClick={() => setSelection(eligible)}>
              全选
            </Button>
            <Button variant="subtle" onClick={() => setSelection([])}>
              全不选
            </Button>
          </Group>
          <Checkbox.Group value={selection ?? []} onChange={setSelection}>
            <Stack gap="xs">
              {eligible.map((language) => (
                <Checkbox
                  key={language}
                  value={language}
                  label={
                    language === primary ? language + "（商店默认）" : language
                  }
                />
              ))}
            </Stack>
          </Checkbox.Group>
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
      <Modal
        opened={opened && !!preview}
        onClose={() => setPreview(null)}
        title="商店图片预览"
        size="850px"
      >
        {preview?.url && (
          <Stack>
            <img className="image-preview" src={preview.url} alt="商店图片" />
            <Text size="xs" c="dimmed">
              {graphicLabels[preview.deviceType as GraphicType] ??
                groupLabel(preview.deviceType)}{" "}
              · {preview.width} × {preview.height}
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
                下载图片
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
