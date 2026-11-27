"use client";
import { uploadImages, appendImages } from "../lib/store-image-client";
import { readApiResponse } from "../lib/api-response";
import { isJobActive } from "../lib/job-status";
import { poll } from "../lib/poll";
import { storeImage } from "../lib/store-image-client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  FileButton,
  Group,
  Modal,
  NativeSelect,
  Paper,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
  ThemeIcon,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Check, ImagePlus, Sparkles } from "lucide-react";
import type { ImageRecord, ImageSettings } from "../lib/image-model";
import type { Platform } from "../lib/model";
import {
  GeneratedImageResults,
  GeneratedImagePreview,
} from "./generated-images";
export function ImageGenerator({
  appId,
  platform,
  locale,
  sourceImages,
  screenSize,
  deviceGroup,
  deviceLabel,
  enabled,
  onAdd,
}: {
  appId: string;
  platform: Platform;
  locale: string;
  sourceImages: string[];
  screenSize?: string;
  deviceGroup: string;
  deviceLabel: string;
  enabled: boolean;
  onAdd: (url: string) => void;
}) {
  const [opened, setOpened] = useState(false);
  const [tab, setTab] = useState<string | null>("create");
  const [settings, setSettings] = useState<ImageSettings>({
    prompt: "",
    references: [],
    modelSize: "auto",
    quality: "auto",
  });
  const modelSize = screenSize ?? settings.modelSize;
  const [records, setImages] = useState<ImageRecord[]>([]);
  const images = records.filter(
    (record) =>
      record.input.deviceGroup === deviceGroup &&
      record.input.settings.modelSize === modelSize,
  );
  const [preview, setPreview] = useState<ImageRecord | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [uploaded, setUploaded] = useState({
    screenshots: [] as string[],
    materials: [] as string[],
  });
  const pending = useRef<{
    requestId: string;
    settings: ImageSettings;
    screenshots: string[];
  } | null>(null);
  const sending = useRef(false);
  const [retryPending, setRetryPending] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `/api/images?${new URLSearchParams({ appId, platform, locale, deviceGroup, modelSize })}`,
        { cache: "no-store", signal },
      );
      const data = await readApiResponse(response);
      setImages(data.images);
    },
    [appId, platform, locale, deviceGroup, modelSize],
  );
  useEffect(() => {
    if (!opened) return;
    setLoading(true);
    const load = async (signal: AbortSignal) => {
      try {
        await refresh(signal);
      } catch (e) {
        if (!signal.aborted)
          setMessage(e instanceof Error ? e.message : "无法读取生成记录");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    };
    return poll(load, 3000);
  }, [opened, refresh]);
  async function generate() {
    if (sending.current || !screenshots.length || !settings.prompt.trim())
      return;
    sending.current = true;
    setBusy(true);
    setMessage("");
    pending.current ??= {
      requestId: crypto.randomUUID(),
      settings: structuredClone({
        ...settings,
        modelSize,
      }),
      screenshots: [...screenshots],
    };
    try {
      const response = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId,
          platform,
          locale,
          deviceGroup,
          ...pending.current,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        pending.current = null;
        setRetryPending(false);
        throw new Error(data.error);
      }
      pending.current = null;
      setRetryPending(false);
      setTab("results");
      notifications.show({
        title: "图片已开始生成",
        message: "可以关闭弹窗，稍后回来查看结果。",
      });
      await refresh();
    } catch (e) {
      setRetryPending(!!pending.current);
      setMessage(e instanceof Error ? e.message : "提交失败，请重试");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function upload(files: File[], area: "screenshots" | "materials") {
    if (!files.length) return;
    setBusy(true);
    setMessage("");
    const selected = area === "screenshots" ? screenshots : settings.references;
    const limit = area === "screenshots" ? 50 : 4;
    try {
      if (selected.length + files.length > limit)
        throw new Error(`该区域最多可选择 ${limit} 张图片`);
      for await (const url of uploadImages(
        files,
        area === "screenshots" && deviceGroup
          ? {
              kind: "screenshot",
              appId,
              platform,
              group: deviceGroup,
              preferred: screenSize,
            }
          : undefined,
      )) {
        const append = (urls: string[]) => appendImages(urls, [url]);
        setUploaded((current) => ({
          ...current,
          [area]: append(current[area]),
        }));
        if (area === "screenshots") setScreenshots(append);
        else
          setSettings((current) => ({
            ...current,
            references: append(current.references),
          }));
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }
  async function updateRecord(id: string, method: "POST" | "DELETE") {
    setDeleting(id);
    setMessage("");
    try {
      const response = await fetch(`/api/images/${id}`, { method });
      await readApiResponse(response);
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "更新生成记录失败");
    } finally {
      setDeleting(null);
    }
  }
  const [converted, setConverted] = useState<Record<string, string>>({});
  const alreadyAdded = (url: string) =>
    sourceImages.includes(converted[url] ?? url);
  async function add(image: ImageRecord) {
    if (!image.result?.url) return;
    setBusy(true);
    try {
      const original = image.result.url;
      const url = await storeImage(original, {
        kind: "screenshot",
        platform,
        appId,
        group: deviceGroup,
        preferred: screenSize,
      });
      setConverted((prev) => ({ ...prev, [original]: url }));
      onAdd(url);
      notifications.show({
        title: "已加入商店截图",
        message: "可以在页面中调整顺序。",
        icon: <Check size={16} />,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片处理失败");
    } finally {
      setBusy(false);
    }
  }

  const disabled = !enabled || busy || retryPending;
  const activeCount = images.filter((image) =>
    isJobActive(image.status),
  ).length;
  return (
    <>
      <Button
        variant="light"
        leftSection={<Sparkles size={16} />}
        onClick={() => {
          setOpened(true);
        }}
        data-testid="open-image-generator"
      >
        AI 生成
        {activeCount > 0 && (
          <Badge size="xs" variant="filled" ml="xs">
            {activeCount}
          </Badge>
        )}
      </Button>
      <Modal
        opened={opened && !preview}
        onClose={() => setOpened(false)}
        title={
          <Group gap="xs">
            <ThemeIcon variant="light">
              <Sparkles size={17} />
            </ThemeIcon>
            <div>
              <Text fw={650}>AI 生成截图</Text>
              <Text size="xs" c="dimmed">
                {platform === "apple" ? "App Store" : "Google Play"} · {locale}{" "}
                · {deviceLabel} ·{" "}
                {modelSize === "auto"
                  ? "自动分辨率"
                  : modelSize.replace("x", " × ") + " px"}
              </Text>
            </div>
          </Group>
        }
        size="760px"
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
      >
        <Tabs value={tab} onChange={setTab} keepMounted={false}>
          <Tabs.List mb="xl">
            <Tabs.Tab value="create">1 · 描述画面</Tabs.Tab>
            <Tabs.Tab value="results">
              2 · 查看结果
              {images.length > 0 && (
                <Badge size="xs" color="gray" ml="xs">
                  {images.length}
                </Badge>
              )}
            </Tabs.Tab>
          </Tabs.List>
          {message && (
            <Alert
              color="orange"
              mb="md"
              withCloseButton
              onClose={() => setMessage("")}
            >
              {message}
            </Alert>
          )}
          <Tabs.Panel value="create">
            <Stack gap="lg">
              <Textarea
                data-autofocus
                label="你想生成什么样的截图？"
                description={`整批共用视觉风格，宣传标题使用 ${locale}。可指定文案或要求无标题，原截图保留界面文字。`}
                placeholder={`例如：为 ${locale} 制作简洁的商店截图，使用浅绿色背景，突出应用界面，顶部标题为…`}
                minRows={5}
                autosize
                maxRows={9}
                maxLength={8000}
                value={settings.prompt}
                disabled={disabled}
                onChange={(e) =>
                  setSettings({ ...settings, prompt: e.currentTarget.value })
                }
              />
              {(["screenshots", "materials"] as const).map((area) => {
                const isScreenshot = area === "screenshots";
                const label = isScreenshot ? "截图" : "素材";
                const selected = isScreenshot
                  ? screenshots
                  : settings.references;
                const limit = isScreenshot ? 50 : 4;
                const choices = [
                  ...new Set([
                    ...(isScreenshot ? sourceImages : []),
                    ...uploaded[area],
                    ...selected,
                  ]),
                ];
                return (
                  <Paper key={area} p="md" withBorder>
                    <Group justify="space-between" mb="sm">
                      <div>
                        <Text fw={550}>
                          {label} · {selected.length} / {limit}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {isScreenshot
                            ? "每张选中的截图生成一张结果。"
                            : "可选。选中的素材用于每张截图的生成。"}
                        </Text>
                      </div>
                      <FileButton
                        multiple
                        accept="image/png,image/jpeg"
                        onChange={(files) => void upload(files, area)}
                      >
                        {(props) => (
                          <Button
                            {...props}
                            size="xs"
                            variant="default"
                            disabled={disabled || selected.length >= limit}
                            leftSection={<ImagePlus size={14} />}
                          >
                            上传{label}
                          </Button>
                        )}
                      </FileButton>
                    </Group>
                    <Group gap="sm">
                      {choices.map((url, i) => {
                        const position = selected.indexOf(url);
                        return (
                          <button
                            type="button"
                            key={url}
                            className="reference-choice"
                            data-selected={position >= 0}
                            aria-pressed={position >= 0}
                            aria-label={`${label} ${i + 1}`}
                            disabled={
                              disabled ||
                              (position < 0 && selected.length >= limit)
                            }
                            onClick={() => {
                              const next =
                                position >= 0
                                  ? selected.filter((item) => item !== url)
                                  : [...selected, url];
                              if (isScreenshot) setScreenshots(next);
                              else
                                setSettings({ ...settings, references: next });
                            }}
                          >
                            <img src={url} alt={`${label} ${i + 1}`} />
                            <Text size="xs">
                              {position >= 0
                                ? `已选 · ${position + 1}`
                                : "选择"}
                            </Text>
                          </button>
                        );
                      })}
                    </Group>
                  </Paper>
                );
              })}
              <Accordion variant="default">
                <Accordion.Item value="options">
                  <Accordion.Control>高级选项</Accordion.Control>
                  <Accordion.Panel>
                    <SimpleGrid cols={{ base: 1, xs: 2 }}>
                      <NativeSelect
                        label="生成尺寸"
                        value={
                          pending.current?.settings.modelSize ??
                          screenSize ??
                          settings.modelSize
                        }
                        disabled={disabled || !!screenSize}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            modelSize: e.currentTarget
                              .value as ImageSettings["modelSize"],
                          })
                        }
                        data={
                          screenSize
                            ? [
                                pending.current?.settings.modelSize ??
                                  screenSize,
                              ]
                            : [
                                { value: "auto", label: "模型自动选择" },
                                "1024x1024",
                                "1024x1536",
                                "1536x1024",
                              ]
                        }
                      />
                      <NativeSelect
                        label="生成质量"
                        value={settings.quality}
                        disabled={disabled}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            quality: e.currentTarget
                              .value as ImageSettings["quality"],
                          })
                        }
                        data={[
                          { value: "auto", label: "自动" },
                          { value: "low", label: "低" },
                          { value: "medium", label: "中" },
                          { value: "high", label: "高" },
                        ]}
                      />
                    </SimpleGrid>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
              <Group justify="space-between" className="modal-footer">
                <Text size="xs" c="dimmed" maw={330}>
                  每次调用发送一张截图和所选素材。
                  <br />
                  提交后可关闭弹窗，任务继续运行。
                </Text>
                <Button
                  leftSection={<Sparkles size={15} />}
                  loading={busy}
                  disabled={
                    !enabled || !screenshots.length || !settings.prompt.trim()
                  }
                  onClick={() => void generate()}
                >
                  {retryPending
                    ? "重试同一请求"
                    : `生成 ${screenshots.length} 张图片`}
                </Button>
              </Group>
            </Stack>
          </Tabs.Panel>
          <GeneratedImageResults
            appId={appId}
            platform={platform}
            locale={locale}
            deviceLabel={deviceLabel}
            images={images}
            setTab={setTab}
            loading={loading}
            deleting={deleting}
            remove={(id) => updateRecord(id, "DELETE")}
            retry={(id) => updateRecord(id, "POST")}
            setPreview={setPreview}
            disabled={disabled}
            alreadyAdded={alreadyAdded}
            add={add}
          />
        </Tabs>
      </Modal>
      <GeneratedImagePreview
        images={images}
        opened={opened}
        preview={preview}
        setPreview={setPreview}
        disabled={disabled}
        alreadyAdded={alreadyAdded}
        add={add}
      />
    </>
  );
}
