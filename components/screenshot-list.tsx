"use client";
import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  FileButton,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  ImagePlus,
  Plus,
  X,
} from "lucide-react";
import { ImageGenerator } from "./image-generator";
import type { Platform } from "../lib/model";
export function ScreenshotList({
  appId,
  platform,
  locale,
  images,
  enabled,
  updateImages,
}: {
  appId: string;
  platform: Platform;
  locale: string;
  images: string[];
  enabled: boolean;
  updateImages: (fn: (current: string[]) => string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  async function upload(files: File[]) {
    setBusy(true);
    const added: string[] = [];
    try {
      if (images.length + files.length > 50)
        throw new Error("每种语言最多保存 50 张截图");
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024)
          throw new Error(`${file.name} 超过 20 MB`);
        const form = new FormData();
        form.set("file", file);
        const r = await fetch("/api/assets", { method: "POST", body: form });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        added.push(data.url);
      }
    } catch (e) {
      notifications.show({
        color: "red",
        message: e instanceof Error ? e.message : "上传失败",
      });
    } finally {
      if (added.length)
        updateImages((current) => [...new Set([...current, ...added])]);
      setBusy(false);
    }
  }
  function move(index: number, direction: number) {
    updateImages((current) => {
      const next = [...current];
      [next[index], next[index + direction]] = [
        next[index + direction],
        next[index],
      ];
      return next;
    });
  }
  return (
    <Paper p={{ base: "md", sm: "xl" }}>
      <Group justify="space-between" mb="lg">
        <div>
          <Group gap="sm">
            <Title order={3} size="h4">
              商店截图
            </Title>
            <Badge color="gray" variant="light" size="sm">
              {images.length} 张
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mt={5}>
            选择最能展示应用的画面，按商店展示顺序排列。
          </Text>
        </div>
        <Group gap="xs">
          <FileButton
            onChange={(files) => void upload(files)}
            accept="image/png,image/jpeg"
            multiple
          >
            {(props) => (
              <Button
                {...props}
                variant="default"
                leftSection={<ImagePlus size={15} />}
                loading={busy}
                disabled={!enabled}
              >
                上传截图
              </Button>
            )}
          </FileButton>
          <ImageGenerator
            appId={appId}
            platform={platform}
            locale={locale}
            sourceImages={images}
            enabled={enabled && !busy && images.length < 50}
            onAdd={(url) =>
              updateImages((current) =>
                [...new Set([...current, url])].slice(0, 50),
              )
            }
          />
        </Group>
      </Group>
      {!images.length ? (
        <Stack
          align="center"
          py={32}
          gap="sm"
          bg="gray.0"
          style={{ borderRadius: 10 }}
        >
          <ImagePlus size={30} color="#87a392" />
          <Text fw={550} size="sm">
            为你的应用添加第一张截图
          </Text>
          <Text size="xs" c="dimmed">
            上传成品截图，或使用 AI 生成新的画面。
          </Text>
        </Stack>
      ) : (
        <div className="screenshot-strip">
          {images.map((src, i) => (
            <div className="screenshot-card" key={`${src}:${i}`}>
              <button
                type="button"
                className="preview-button"
                aria-label={`预览截图 ${i + 1}`}
                onClick={() => setPreview(src)}
              >
                <img
                  className="screenshot-image"
                  src={src}
                  alt={`截图 ${i + 1}`}
                />
              </button>
              <Group justify="space-between" mt="xs" gap={4}>
                <Text size="xs" c="dimmed">
                  {String(i + 1).padStart(2, "0")}
                </Text>
                <Group gap={2}>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    aria-label={`前移截图 ${i + 1}`}
                    disabled={!enabled || i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowLeft size={13} />
                  </ActionIcon>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    aria-label={`后移截图 ${i + 1}`}
                    disabled={!enabled || i === images.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowRight size={13} />
                  </ActionIcon>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    aria-label={`移除截图 ${i + 1}`}
                    disabled={!enabled}
                    onClick={() =>
                      updateImages((current) =>
                        current.filter((_, n) => n !== i),
                      )
                    }
                  >
                    <X size={13} />
                  </ActionIcon>
                </Group>
              </Group>
            </div>
          ))}
        </div>
      )}
      <Text size="xs" c="dimmed" mt="md">
        PNG / JPEG · 每张最多 20 MB · 上传前请确认目标商店的尺寸要求
      </Text>
      <Modal
        opened={!!preview}
        onClose={() => setPreview(null)}
        title="截图预览"
        size="850px"
      >
        {preview && (
          <Stack>
            <img className="image-preview" src={preview} alt="商店截图预览" />
            <Group justify="end">
              <Button
                component="a"
                href={preview}
                download="store-screenshot.png"
                leftSection={<Download size={15} />}
              >
                下载图片
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Paper>
  );
}
