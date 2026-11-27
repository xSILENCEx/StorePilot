"use client";
import { ImageReviewActions } from "./image-review-actions";
import { resolutionLabel } from "../lib/image-resolution";
import { isJobActive } from "../lib/job-status";
import { ImagePreview, previewNavigation } from "./image-preview";
import { BatchDownload } from "./batch-download";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { ArrowRight, ImagePlus, Sparkles, Trash2 } from "lucide-react";
import type { ImageRecord } from "../lib/image-model";
import type { Platform } from "../lib/model";
const statuses: Record<string, string> = {
  paused: "待确认尺寸",
  cancelled: "已停止",
  queued: "排队中",
  running: "正在生成",
  succeeded: "已生成",
  failed: "生成失败",
  uncertain: "调用结果未知",
};
export function GeneratedImageResults({
  appId,
  platform,
  locale,
  deviceLabel,
  images,
  setTab,
  loading,
  deleting,
  remove,
  retry,
  setPreview,
  disabled,
  alreadyAdded,
  add,
}: {
  appId: string;
  platform: Platform;
  locale: string;
  deviceLabel: string;
  images: ImageRecord[];
  setTab: (tab: string) => void;
  loading: boolean;
  deleting: string | null;
  remove: (id: string) => void;
  retry: (id: string) => void;
  setPreview: (image: ImageRecord | null) => void;
  disabled: boolean;
  alreadyAdded: (url: string) => boolean;
  add: (image: ImageRecord) => void;
}) {
  return (
    <Tabs.Panel value="results">
      <Stack>
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            生成结果仅在你选择后加入截图列表。
          </Text>
          <Group gap="xs">
            <BatchDownload
              appId={appId}
              platform={platform}
              locale={locale}
              group={deviceLabel + "生成图"}
              items={images.flatMap((image) =>
                image.result?.url ? [{ url: image.result.url }] : [],
              )}
            />
            <Button
              size="xs"
              variant="subtle"
              leftSection={<Sparkles size={14} />}
              onClick={() => setTab("create")}
            >
              再次生成
            </Button>
          </Group>
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
                      {isJobActive(image.status) ? (
                        <Loader size="sm" />
                      ) : (
                        <ImagePlus
                          size={24}
                          color="var(--mantine-color-dimmed)"
                        />
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
                          : "green"
                      }
                      size="sm"
                    >
                      {statuses[image.status]}
                    </Badge>
                    {!isJobActive(image.status) &&
                      image.status !== "paused" && (
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
                  {image.input.screenshotIndex != null && (
                    <Text size="sm">
                      截图 {image.input.screenshotIndex + 1} /{" "}
                      {image.input.screenshots?.length}
                    </Text>
                  )}
                  <Text size="xs" c="dimmed" lineClamp={2}>
                    {image.input.settings.prompt}
                  </Text>
                  {image.status === "failed" && (
                    <Button
                      size="xs"
                      variant="default"
                      disabled={disabled || deleting === image.id}
                      onClick={() => retry(image.id)}
                    >
                      重试此张
                    </Button>
                  )}
                  {image.result?.error && (
                    <Text size="xs" c="orange.8" role="alert">
                      {image.result.error}
                    </Text>
                  )}
                  {image.status === "paused" && image.result?.review && (
                    <ImageReviewActions
                      key={image.result.review.token}
                      id={image.id}
                      review={image.result.review}
                    />
                  )}
                  {image.result?.resolution && (
                    <Text size="xs">
                      {resolutionLabel(image.result.resolution)}
                    </Text>
                  )}
                  {image.status === "succeeded" && image.result?.url && (
                    <Button
                      size="xs"
                      variant="light"
                      disabled={disabled || alreadyAdded(image.result.url)}
                      onClick={() => add(image)}
                    >
                      {alreadyAdded(image.result.url)
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
          请核对文字、UI 和目标商店的尺寸要求。调用结果未知时不会自动重发。
        </Text>
      </Stack>
    </Tabs.Panel>
  );
}
export function GeneratedImagePreview({
  opened,
  images,
  preview,
  setPreview,
  disabled,
  alreadyAdded,
  add,
}: {
  opened: boolean;
  images: ImageRecord[];
  preview: ImageRecord | null;
  setPreview: (image: ImageRecord | null) => void;
  disabled: boolean;
  alreadyAdded: (url: string) => boolean;
  add: (image: ImageRecord) => void;
}) {
  const batch = images
    .filter(
      (i) =>
        i.result?.url &&
        (i.input.requestId ?? i.id) ===
          (preview?.input.requestId ?? preview?.id),
    )
    .sort(
      (a, b) => (a.input.screenshotIndex ?? 0) - (b.input.screenshotIndex ?? 0),
    );
  return (
    <ImagePreview
      src={opened ? preview?.result?.url : null}
      navigation={previewNavigation(
        batch,
        batch.findIndex((i) => i.id === preview?.id),
        setPreview,
      )}
      alt={preview?.input.settings.prompt ?? ""}
      title="预览生成图片"
      onClose={() => setPreview(null)}
      backLabel="返回结果"
      downloadName={preview ? `screenshot-${preview.id}.png` : undefined}
      caption={
        preview && (
          <>
            <Text size="xs" c="dimmed">
              {preview.result?.width} × {preview.result?.height}
            </Text>
            <Text size="sm">{preview.input.settings.prompt}</Text>
          </>
        )
      }
    >
      {preview?.status === "succeeded" && preview.result?.url && (
        <Button
          disabled={disabled || alreadyAdded(preview.result.url)}
          onClick={() => add(preview)}
        >
          {alreadyAdded(preview.result.url) ? "已加入截图" : "加入商店截图"}
        </Button>
      )}
    </ImagePreview>
  );
}
