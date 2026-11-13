"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Button,
  FileButton,
  Group,
  Loader,
  Modal,
  NativeSelect,
  Paper,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  ImagePlus,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { ImageRecord, ImageSettings } from "../lib/image-model";
import type { Platform } from "../lib/model";
const statuses: Record<string, string> = {
  queued: "排队中",
  running: "正在生成",
  succeeded: "已生成",
  failed: "生成失败",
  uncertain: "调用结果未知",
};
export function ImageGenerator({
  appId,
  platform,
  locale,
  sourceImages,
  enabled,
  onAdd,
}: {
  appId: string;
  platform: Platform;
  locale: string;
  sourceImages: string[];
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
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [preview, setPreview] = useState<ImageRecord | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const pending = useRef<{ requestId: string; settings: ImageSettings } | null>(
    null,
  );
  const sending = useRef(false);
  const [retryPending, setRetryPending] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `/api/images?${new URLSearchParams({ appId, platform, locale })}`,
        { cache: "no-store", signal },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setImages(data.images);
    },
    [appId, platform, locale],
  );
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    setLoading(true);
    const load = async () => {
      try {
        await refresh(controller.signal);
      } catch (e) {
        if (!controller.signal.aborted)
          setMessage(e instanceof Error ? e.message : "无法读取生成记录");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [opened, refresh]);
  async function generate() {
    if (sending.current || !settings.prompt.trim()) return;
    sending.current = true;
    setBusy(true);
    setMessage("");
    pending.current ??= {
      requestId: crypto.randomUUID(),
      settings: structuredClone(settings),
    };
    try {
      const response = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId, platform, locale, ...pending.current }),
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
  async function upload(file: File | null) {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      if (settings.references.length >= 4)
        throw new Error("最多选择四张参考图");
      if (file.size > 20 * 1024 * 1024) throw new Error("参考图不能超过 20 MB");
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/assets", {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setUploaded((current) => [...new Set([...current, data.url])]);
      setSettings((current) => ({
        ...current,
        references: [...new Set([...current.references, data.url])].slice(0, 4),
      }));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setDeleting(id);
    setMessage("");
    try {
      const response = await fetch(`/api/images/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeleting(null);
    }
  }
  function add(image: ImageRecord) {
    if (!image.result?.url) return;
    onAdd(image.result.url);
    notifications.show({
      title: "已加入商店截图",
      message: "可以在页面中调整顺序。",
      icon: <Check size={16} />,
    });
  }
  const references = [...new Set([...sourceImages, ...uploaded])];
  const disabled = !enabled || busy || retryPending;
  const activeCount = images.filter((image) =>
    ["queued", "running"].includes(image.status),
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
                {platform === "apple" ? "App Store" : "Google Play"} · {locale}
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
                description="把画面风格、构图和需要出现的文字写在一起。"
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
              <div>
                <Group justify="space-between" mb="sm">
                  <div>
                    <Text size="sm" fw={550}>
                      参考图{" "}
                      <Text component="span" c="dimmed" fw={400}>
                        （可选）
                      </Text>
                    </Text>
                    <Text size="xs" c="dimmed">
                      已选择 {settings.references.length} / 4 张
                    </Text>
                  </div>
                  <FileButton
                    onChange={(file) => void upload(file)}
                    accept="image/png,image/jpeg"
                  >
                    {(props) => (
                      <Button
                        {...props}
                        size="xs"
                        variant="default"
                        leftSection={<ImagePlus size={14} />}
                        disabled={disabled || settings.references.length >= 4}
                      >
                        上传参考图
                      </Button>
                    )}
                  </FileButton>
                </Group>
                {references.length ? (
                  <Group gap="sm">
                    {references.map((url, i) => {
                      const selected = settings.references.includes(url);
                      return (
                        <button
                          type="button"
                          className="reference-choice"
                          data-selected={selected}
                          aria-pressed={selected}
                          aria-label={`参考图 ${i + 1}`}
                          disabled={
                            disabled ||
                            (!selected && settings.references.length >= 4)
                          }
                          key={url}
                          onClick={() =>
                            setSettings({
                              ...settings,
                              references: selected
                                ? settings.references.filter(
                                    (item) => item !== url,
                                  )
                                : [...settings.references, url],
                            })
                          }
                        >
                          <img src={url} alt={`参考图 ${i + 1}`} />
                          <Text
                            size="xs"
                            c={selected ? "teal.7" : "dimmed"}
                            mt={6}
                          >
                            {selected ? "已选择" : "选择"}
                          </Text>
                        </button>
                      );
                    })}
                  </Group>
                ) : (
                  <Paper p="lg" bg="gray.0" withBorder={false}>
                    <Text size="sm" c="dimmed" ta="center">
                      直接用提示词生成，或上传 App 界面作为参考。
                    </Text>
                  </Paper>
                )}
              </div>
              <Accordion variant="default">
                <Accordion.Item value="options">
                  <Accordion.Control>高级选项</Accordion.Control>
                  <Accordion.Panel>
                    <SimpleGrid cols={{ base: 1, xs: 2 }}>
                      <NativeSelect
                        label="生成尺寸"
                        value={settings.modelSize}
                        disabled={disabled}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            modelSize: e.currentTarget
                              .value as ImageSettings["modelSize"],
                          })
                        }
                        data={[
                          { value: "auto", label: "模型自动选择" },
                          "1024x1024",
                          "1024x1536",
                          "1536x1024",
                        ]}
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
                  使用已配置的图像模型。参考图会发送给该服务。
                  <br />
                  提交后可关闭弹窗，任务继续运行。
                </Text>
                <Button
                  leftSection={<Sparkles size={15} />}
                  loading={busy}
                  disabled={!enabled || !settings.prompt.trim()}
                  onClick={() => void generate()}
                >
                  {retryPending ? "重试同一请求" : "生成一张图片"}
                </Button>
              </Group>
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="results">
            <Stack>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  生成结果仅在你选择后加入截图列表。
                </Text>
                <Button
                  size="xs"
                  variant="subtle"
                  leftSection={<Sparkles size={14} />}
                  onClick={() => setTab("create")}
                >
                  再生成一张
                </Button>
              </Group>
              {loading && !images.length ? (
                <Group justify="center" py="xl">
                  <Loader size="sm" />
                </Group>
              ) : !images.length ? (
                <Stack align="center" py={40}>
                  <ThemeIcon size={52} variant="light" radius="xl">
                    <ImagePlus size={25} />
                  </ThemeIcon>
                  <Title order={4}>还没有生成图片</Title>
                  <Text size="sm" c="dimmed">
                    从一个画面想法开始。
                  </Text>
                  <Button variant="light" onClick={() => setTab("create")}>
                    去描述画面 <ArrowRight size={14} />
                  </Button>
                </Stack>
              ) : (
                <SimpleGrid cols={{ base: 1, xs: 2, sm: 3 }} spacing="md">
                  {images.map((image) => (
                    <Paper p="sm" key={image.id}>
                      <Stack gap="sm">
                        {image.result?.url ? (
                          <button
                            type="button"
                            className="preview-button"
                            aria-label="预览生成图片"
                            onClick={() => setPreview(image)}
                          >
                            <img
                              className="generated-image"
                              src={image.result.url}
                              alt={image.input.settings.prompt}
                            />
                          </button>
                        ) : (
                          <Stack
                            align="center"
                            justify="center"
                            h={160}
                            bg="gray.0"
                            style={{ borderRadius: 8 }}
                          >
                            {["queued", "running"].includes(image.status) ? (
                              <Loader size="sm" />
                            ) : (
                              <ImagePlus size={24} color="#8b9d93" />
                            )}
                            <Text size="sm" c="dimmed">
                              {statuses[image.status]}
                            </Text>
                          </Stack>
                        )}
                        <Group justify="space-between">
                          <Badge
                            variant="light"
                            color={
                              image.status === "failed" ||
                              image.status === "uncertain"
                                ? "orange"
                                : "teal"
                            }
                            size="sm"
                          >
                            {statuses[image.status]}
                          </Badge>
                          {!["queued", "running"].includes(image.status) && (
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              aria-label="删除生成记录"
                              loading={deleting === image.id}
                              onClick={() => void remove(image.id)}
                            >
                              <Trash2 size={14} />
                            </ActionIcon>
                          )}
                        </Group>
                        <Text size="xs" c="dimmed" lineClamp={2}>
                          {image.input.settings.prompt}
                        </Text>
                        {image.result?.error && (
                          <Text size="xs" c="orange.8" role="alert">
                            {image.result.error}
                          </Text>
                        )}
                        {image.result?.url && (
                          <Button
                            size="xs"
                            variant="light"
                            disabled={
                              !enabled ||
                              sourceImages.includes(image.result.url)
                            }
                            onClick={() => add(image)}
                          >
                            {sourceImages.includes(image.result.url)
                              ? "已加入截图"
                              : "加入商店截图"}
                          </Button>
                        )}
                      </Stack>
                    </Paper>
                  ))}
                </SimpleGrid>
              )}
              <Text size="xs" c="dimmed" mt="sm">
                请核对文字、UI
                和目标商店的尺寸要求。调用结果未知时不会自动重发。
              </Text>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Modal>
      <Modal
        opened={opened && !!preview}
        onClose={() => setPreview(null)}
        title="预览生成图片"
        size="850px"
      >
        {preview?.result?.url && (
          <Stack>
            <img
              className="image-preview"
              src={preview.result.url}
              alt={preview.input.settings.prompt}
            />
            <Text size="xs" c="dimmed">
              {preview.result.width} × {preview.result.height}
            </Text>
            <Text size="sm">{preview.input.settings.prompt}</Text>
            <Group justify="space-between" className="modal-footer">
              <Button
                variant="subtle"
                leftSection={<ArrowLeft size={14} />}
                onClick={() => setPreview(null)}
              >
                返回结果
              </Button>
              <Group>
                <Button
                  component="a"
                  variant="default"
                  href={preview.result.url}
                  download={`screenshot-${preview.id}.png`}
                  leftSection={<Download size={15} />}
                >
                  下载
                </Button>
                <Button
                  disabled={
                    !enabled || sourceImages.includes(preview.result.url)
                  }
                  onClick={() => add(preview)}
                >
                  {sourceImages.includes(preview.result.url)
                    ? "已加入截图"
                    : "加入商店截图"}
                </Button>
              </Group>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
