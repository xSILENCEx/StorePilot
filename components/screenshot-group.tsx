"use client";
import { uploadImages, appendImages } from "../lib/store-image-client";
import { hoverActionEvents } from "./hover-actions";
import { BatchDownload } from "./batch-download";
import { storeImage } from "../lib/store-image-client";
import { useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  FileButton,
  Group,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ImagePlus, X } from "lucide-react";
import { ImageGenerator } from "./image-generator";
import {
  groupImages,
  setGroupImages,
  screenshotDocs,
  ungrouped,
  type DeviceGroup,
} from "../lib/screenshot-groups";
import type { Draft, Platform } from "../lib/model";
import { ImagePreview } from "./image-preview";
export type EditorProps = {
  appId: string;
  platform: Platform;
  locale: string;
  draft: Draft;
  catalog?: DeviceGroup[];
  enabled: boolean;
  updateDraft: (fn: (current: Draft) => Partial<Draft>) => void;
};
export function ScreenshotGroup({
  appId,
  platform,
  locale,
  draft,
  enabled,
  updateDraft,
  historical = false,
  sizeControl,
  screenSize,
  group,
  groups,
}: EditorProps & {
  historical?: boolean;
  sizeControl?: React.ReactNode;
  screenSize?: string;
  group: DeviceGroup;
  groups: DeviceGroup[];
}) {
  const images = groupImages(draft, group.value);
  const [destination, setDestination] = useState<string | null>(null);
  function updateImages(fn: (current: string[]) => string[]) {
    updateDraft((current) => {
      const result = fn(groupImages(current, group.value));
      if (result.length > group.limit) {
        notifications.show({
          color: "orange",
          message: `此组最多保存 ${group.limit} 张截图`,
        });
        return {};
      }
      return setGroupImages(current, group.value, result);
    });
  }
  async function moveToGroup(src: string, target: string) {
    setBusy(true);
    try {
      const converted = await storeImage(src, {
        kind: "screenshot",
        platform,
        appId,
        group: target,
      });

      updateDraft((current) => {
        const existing = groupImages(current, target);
        const next = appendImages(existing, [converted]);
        if (
          next.length > (groups.find((g) => g.value === target)?.limit ?? 0)
        ) {
          notifications.show({ color: "orange", message: "目标设备组已满" });
          return {};
        }
        const removed = setGroupImages(
          current,
          group.value,
          groupImages(current, group.value).filter((url) => url !== src),
        );
        return {
          ...removed,
          ...setGroupImages({ ...current, ...removed }, target, next),
        };
      });
      setPreview(null);
    } catch (error) {
      notifications.show({
        color: "red",
        message: error instanceof Error ? error.message : "移动失败",
      });
    } finally {
      setBusy(false);
    }
  }
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  async function upload(files: File[]) {
    setBusy(true);
    const added: string[] = [];
    try {
      if (images.length + files.length > group.limit)
        throw new Error(`此设备组最多保存 ${group.limit} 张截图`);
      for await (const url of uploadImages(files, {
        kind: "screenshot",
        platform,
        appId,
        group: group.value,
        preferred: screenSize,
      }))
        added.push(url);
    } catch (e) {
      notifications.show({
        color: "red",
        message: e instanceof Error ? e.message : "上传失败",
      });
    } finally {
      if (added.length) updateImages((current) => appendImages(current, added));
      setBusy(false);
    }
  }
  const dragged = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  function move(from: number, to: number) {
    if (!enabled || from === to || to < 0 || to >= images.length) return;
    updateImages((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }
  return (
    <>
      <Group justify="space-between" mb="lg">
        <div>
          <Group gap="sm">
            <Title order={3} size="h4">
              商店截图
            </Title>
            <Badge color="gray" variant="light" size="sm">
              {images.length} / {group.limit} 张
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mt={5}>
            拖动截图调整顺序，点击查看大图。
          </Text>
        </div>
        <Group gap="xs">
          <BatchDownload
            size="sm"
            appId={appId}
            platform={platform}
            locale={locale}
            group={group.label + "截图"}
            items={images.map((url) => ({ url }))}
          />
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
                disabled={
                  historical ||
                  !enabled ||
                  group.value === ungrouped ||
                  images.length >= group.limit
                }
              >
                上传截图
              </Button>
            )}
          </FileButton>
          <ImageGenerator
            key={screenSize ?? group.value}
            deviceGroup={group.value}
            deviceLabel={group.label}
            appId={appId}
            platform={platform}
            locale={locale}
            screenSize={screenSize}
            sourceImages={images}
            enabled={
              enabled &&
              !historical &&
              !busy &&
              group.value !== ungrouped &&
              images.length < group.limit
            }
            onAdd={(url) =>
              updateImages((current) => appendImages(current, [url]))
            }
          />
        </Group>
      </Group>
      {group.value === ungrouped && (
        <Text size="xs" c="dimmed" mb="sm">
          旧草稿截图保存在这里。点击截图预览，即可移入设备组。
        </Text>
      )}
      {!images.length ? (
        <Stack
          align="center"
          py={32}
          gap="sm"
          bg="gray.0"
          style={{ borderRadius: 10 }}
        >
          <ImagePlus size={30} color="var(--mantine-color-dimmed)" />
          <Text fw={550} size="sm">
            为你的应用添加第一张截图
          </Text>
          <Text size="xs" c="dimmed">
            上传成品截图，或使用 AI 生成新的画面。
          </Text>
        </Stack>
      ) : (
        <div
          className="screenshot-strip"
          onDragOver={(event) => {
            if (!enabled || dragged.current === null) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const slots = Array.from(event.currentTarget.children);
            const first = slots[0].getBoundingClientRect();
            const pitch =
              slots.length > 1
                ? slots[1].getBoundingClientRect().left - first.left
                : first.width;
            const index = Math.round(
              (event.clientX - first.left - first.width / 2) / pitch,
            );
            setDropTarget(Math.max(0, Math.min(index, slots.length - 1)));
          }}
          onDrop={(event) => {
            if (dragged.current === null) return;
            event.preventDefault();
            if (dropTarget !== null) move(dragged.current, dropTarget);
            dragged.current = null;
            setDropTarget(null);
          }}
        >
          {images.map((src, i) => {
            const from = dragged.current;
            let offset = 0;
            if (from !== null && dropTarget !== null) {
              if (i === from) offset = dropTarget - from;
              else if (i > from && i <= dropTarget) offset = -1;
              else if (i < from && i >= dropTarget) offset = 1;
            }
            return (
              <div className="screenshot-card" key={`${src}:${i}`}>
                <div
                  className="screenshot-sort-item"
                  data-dragging={from === i && dropTarget !== null}
                  style={{
                    transform: `translateX(calc(${offset * 100}% + ${offset} * var(--screenshot-gap)))`,
                  }}
                >
                  <div className="screenshot-thumbnail" {...hoverActionEvents}>
                    <button
                      type="button"
                      className="preview-button"
                      draggable={enabled}
                      aria-label={`预览截图 ${i + 1}`}
                      title="点击预览，拖动排序；也可按 Alt + 左右键排序"
                      onDragStart={(event) => {
                        dragged.current = i;
                        setDropTarget(i);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", String(i));
                      }}
                      onDragEnd={() => {
                        dragged.current = null;
                        setDropTarget(null);
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.altKey &&
                          ["ArrowLeft", "ArrowRight"].includes(event.key)
                        ) {
                          event.preventDefault();
                          move(i, i + (event.key === "ArrowLeft" ? -1 : 1));
                        }
                      }}
                      onClick={() => setPreview(src)}
                    >
                      <img
                        className="screenshot-image"
                        draggable={false}
                        src={src}
                        alt={`截图 ${i + 1}`}
                      />
                    </button>
                    <ActionIcon
                      className="screenshot-remove"
                      size="sm"
                      variant="white"
                      color="red"
                      aria-label={`移除截图 ${i + 1}`}
                      disabled={!enabled}
                      onClick={() =>
                        updateImages((current) =>
                          current.filter((_, n) => n !== i),
                        )
                      }
                    >
                      <X size={14} />
                    </ActionIcon>
                  </div>
                  <Text size="xs" c="dimmed" mt="xs">
                    {String(i + 1).padStart(2, "0")}
                  </Text>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Group gap="xs" mt="md">
        <Text size="xs" c="dimmed">
          PNG / JPEG · 每张最多 20 MB
        </Text>
        {sizeControl}
        {platform === "google" && (
          <Text
            component="a"
            size="xs"
            href={screenshotDocs.google}
            target="_blank"
            rel="noreferrer"
          >
            查看商店截图规格
          </Text>
        )}
      </Group>
      <ImagePreview
        src={preview}
        alt="商店截图预览"
        title="截图预览"
        downloadName="store-screenshot.png"
        onClose={() => setPreview(null)}
      >
        {preview && (
          <Group align="end">
            <Select
              label="移入设备组"
              searchable
              value={destination}
              onChange={setDestination}
              data={groups.filter(
                (g) => g.value !== group.value && g.value !== ungrouped,
              )}
            />
            <Button
              variant="default"
              disabled={!enabled || busy || !destination}
              onClick={() => destination && moveToGroup(preview, destination)}
            >
              移动截图
            </Button>
          </Group>
        )}
      </ImagePreview>
    </>
  );
}
