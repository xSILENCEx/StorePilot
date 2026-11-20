"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  FileButton,
  Group,
  Modal,
  TextInput,
  Menu,
  Anchor,
  Paper,
  Select,
  Stack,
  Text,
  Title,
  Tabs,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  Download,
  ChevronDown,
  Check,
  ImagePlus,
  X,
  Smartphone,
  Tablet,
  Watch,
  Monitor,
  Tv,
  Laptop,
  Car,
  Glasses,
  Images,
  PanelsTopLeft,
} from "lucide-react";
import { ImageGenerator } from "./image-generator";
import {
  deviceGroups,
  groupImages,
  setGroupImages,
  screenshotDocs,
  screenDimensions,
  googleScreenshotDevices,
  validGoogleDimensions,
  ungrouped,
  type DeviceGroup,
} from "../lib/screenshot-groups";
import type { Draft, Platform } from "../lib/model";
function ScreenshotViewer({ src }: { src: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    function zoom(event: WheelEvent) {
      event.preventDefault();
      const bounds = element!.getBoundingClientRect();
      const x = event.clientX - bounds.left - bounds.width / 2;
      const y = event.clientY - bounds.top - bounds.height / 2;
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? bounds.height
            : 1);
      setView((previous) => {
        const scale = Math.min(
          8,
          Math.max(0.25, previous.scale * Math.exp(-delta * 0.002)),
        );
        const ratio = scale / previous.scale;
        return {
          scale,
          x: x + (previous.x - x) * ratio,
          y: y + (previous.y - y) * ratio,
        };
      });
    }
    element.addEventListener("wheel", zoom, { passive: false });
    return () => element.removeEventListener("wheel", zoom);
  }, []);
  return (
    <div
      ref={viewport}
      className="screenshot-viewport"
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointer.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
      }}
      onPointerMove={(event) => {
        const last = pointer.current;
        if (!last || last.id !== event.pointerId) return;
        const dx = event.clientX - last.x,
          dy = event.clientY - last.y;
        last.x = event.clientX;
        last.y = event.clientY;
        setView((previous) => ({
          ...previous,
          x: previous.x + dx,
          y: previous.y + dy,
        }));
      }}
      onLostPointerCapture={() => {
        pointer.current = null;
      }}
    >
      <img
        src={src}
        alt="商店截图预览"
        draggable={false}
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      />
    </div>
  );
}
type EditorProps = {
  appId: string;
  platform: Platform;
  locale: string;
  draft: Draft;
  catalog?: DeviceGroup[];
  enabled: boolean;
  updateDraft: (fn: (current: Draft) => Partial<Draft>) => void;
};
function category(device: DeviceGroup) {
  const key = (device.value + " " + device.label).toUpperCase();
  if (key.includes("IMESSAGE")) return "iMessage";
  if (key.includes("DUO")) return "iPhone Duo";
  if (key.includes("IPHONE")) return "iPhone";
  if (key.includes("IPAD")) return "iPad";
  if (key.includes("WATCH")) return "Apple Watch";
  if (key.includes("VISION")) return "Apple Vision Pro";
  if (key.includes("MAC") || key.includes("DESKTOP")) return "Mac";
  if (
    key.includes("TV") &&
    !key.includes("ANDROID") &&
    device.value !== "tvScreenshots"
  )
    return "Apple TV";
  return device.label.split(" · ")[0];
}
const icons: Record<string, typeof Smartphone> = {
  iPad: Tablet,
  平板: Tablet,
  "Apple Watch": Watch,
  "Wear OS": Watch,
  Mac: Monitor,
  Chromebook: Laptop,
  "Apple TV": Tv,
  "Android TV": Tv,
  "Android Automotive OS": Car,
  "Android XR": Glasses,
  "Apple Vision Pro": Glasses,
  待分组: Images,
  "iPhone Duo": PanelsTopLeft,
  折叠屏: PanelsTopLeft,
};
const appleCategories = ["iPhone", "iPhone Duo", "iPad", "Apple Watch"];

export function ScreenshotList(props: EditorProps) {
  const { draft, platform, catalog } = props;
  const available = deviceGroups(
    platform,
    Object.keys(draft.screenshotGroups ?? {}).filter(
      (key) => platform === "apple" || groupImages(draft, key).length > 0,
    ),
    catalog,
  );
  if (draft.images.length)
    available.unshift({ value: ungrouped, label: "待分组", limit: 50 });
  const groups =
    platform === "apple"
      ? appleCategories.flatMap((name) => {
          const matches = available.filter(
            (device) => category(device) === name,
          );
          return matches.length
            ? matches
            : deviceGroups("apple", []).filter(
                (device) => category(device) === name,
              );
        })
      : available;
  const historical = available.filter(
    (device) =>
      !groups.includes(device) && groupImages(draft, device.value).length,
  );
  const [selected, setSelected] = useState<string>();
  const group =
    groups.find((g) => g.value === selected) ??
    (platform === "apple"
      ? groups.find((g) => g.label === "iPhone · 灵动岛中屏")
      : undefined) ??
    groups.find((g) => groupImages(draft, g.value).length) ??
    groups[0];
  const families = Object.groupBy(groups, category);
  const family = category(group);
  const [pixels, setPixels] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<{
    device: DeviceGroup;
    width: string;
    height: string;
  } | null>(null);
  const customValid =
    custom &&
    /^\d+$/.test(custom.width) &&
    /^\d+$/.test(custom.height) &&
    validGoogleDimensions(
      custom.device.value,
      Number(custom.width),
      Number(custom.height),
    );
  const sizes = families[family]!.flatMap((device) =>
    [
      ...new Set([
        ...screenDimensions(device),
        ...(pixels[device.value] ? [pixels[device.value]] : []),
      ]),
    ].map((size) => ({
      device,
      size,
      value: device.value + ":" + size,
      label: size + " px",
    })),
  );
  const currentSize =
    sizes.find(
      (option) =>
        option.device.value === group.value &&
        option.size === pixels[group.value],
    ) ?? sizes.find((option) => option.device.value === group.value);
  const [remembered, setRemembered] = useState<Record<string, string>>({});
  function selectDevice(device: DeviceGroup) {
    setSelected(device.value);
    setRemembered((previous) => ({
      ...previous,
      [category(device)]: device.value,
    }));
  }
  function preferred(name: string) {
    const options = families[name]!;
    return (
      options.find((d) => d.value === remembered[name]) ??
      options.find((d) => groupImages(draft, d.value).length) ??
      options[0]
    );
  }
  return (
    <Paper p={{ base: "md", sm: "xl" }}>
      <Tabs
        value={family}
        onChange={(name) => name && selectDevice(preferred(name))}
        color="dark"
      >
        <Tabs.List aria-label="设备类别" className="screenshot-device-tabs">
          {Object.keys(families).map((name) => {
            const Icon = icons[name] ?? Smartphone;
            const device = name === family ? group : preferred(name);
            return (
              <Tabs.Tab
                key={name}
                value={name}
                leftSection={<Icon size={24} strokeWidth={1.4} />}
              >
                {name}
                {families[name]!.length > 1 && (
                  <Text component="span" display="block" size="xs" c="dimmed">
                    {device.label.replace(name + " · ", "")}
                  </Text>
                )}
              </Tabs.Tab>
            );
          })}
        </Tabs.List>
        <Tabs.Panel value={family} pt="md">
          <ScreenshotGroup
            key={group.value}
            {...props}
            group={group}
            groups={groups}
            screenSize={currentSize?.size.replace(" × ", "x")}
            sizeControl={
              sizes.length > 0 ? (
                <Group gap="xs">
                  <Menu position="bottom-start">
                    <Menu.Target>
                      <Anchor component="button" type="button" size="xs">
                        <Group component="span" gap={3} wrap="nowrap">
                          屏幕规格 <ChevronDown size={12} aria-hidden="true" />
                        </Group>
                      </Anchor>
                    </Menu.Target>
                    <Menu.Dropdown
                      mah="min(320px, 50dvh)"
                      style={{ overflowY: "auto" }}
                    >
                      {families[family]!.map((device) => (
                        <Fragment key={device.value}>
                          {families[family]!.length > 1 && (
                            <Menu.Label>{device.label}</Menu.Label>
                          )}
                          {sizes
                            .filter(
                              (option) => option.device.value === device.value,
                            )
                            .map((option) => (
                              <Menu.Item
                                key={option.value}
                                rightSection={
                                  currentSize?.value === option.value ? (
                                    <Check size={14} />
                                  ) : undefined
                                }
                                onClick={() => {
                                  selectDevice(option.device);
                                  setPixels((previous) => ({
                                    ...previous,
                                    [option.device.value]: option.size,
                                  }));
                                }}
                              >
                                {option.label}
                              </Menu.Item>
                            ))}
                          {platform === "google" &&
                            Object.hasOwn(
                              googleScreenshotDevices,
                              device.value,
                            ) && (
                              <Menu.Item
                                onClick={() => {
                                  const [width, height] = (
                                    pixels[device.value] ??
                                    screenDimensions(device)[0]
                                  ).split(" × ");
                                  setCustom({ device, width, height });
                                }}
                              >
                                自定义分辨率…
                              </Menu.Item>
                            )}
                        </Fragment>
                      ))}
                    </Menu.Dropdown>
                  </Menu>
                  <Text component="span" size="xs" c="dimmed">
                    {currentSize?.label}
                  </Text>
                </Group>
              ) : undefined
            }
          />
          {platform === "google" &&
            !sizes.length &&
            families[family]!.length > 1 && (
              <Select
                label="屏幕规格"
                size="sm"
                mt="md"
                maw={360}
                value={group.value}
                allowDeselect={false}
                data={families[family]!.map((device) => ({
                  value: device.value,
                  label: `${device.label}（${groupImages(draft, device.value).length}）`,
                }))}
                onChange={(value) => {
                  const device = families[family]!.find(
                    (item) => item.value === value,
                  );
                  if (device) selectDevice(device);
                }}
              />
            )}
        </Tabs.Panel>
      </Tabs>
      <Modal
        opened={!!custom}
        onClose={() => setCustom(null)}
        title={custom?.device.label + " · 自定义分辨率"}
      >
        {custom && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!customValid) return;
              selectDevice(custom.device);
              setPixels((previous) => ({
                ...previous,
                [custom.device.value]:
                  Number(custom.width) + " × " + Number(custom.height),
              }));
              setCustom(null);
            }}
          >
            <Stack>
              <Group grow>
                <TextInput
                  label="宽度（px）"
                  inputMode="numeric"
                  value={custom.width}
                  onChange={(e) =>
                    setCustom({ ...custom, width: e.currentTarget.value })
                  }
                />
                <TextInput
                  label="高度（px）"
                  inputMode="numeric"
                  value={custom.height}
                  onChange={(e) =>
                    setCustom({ ...custom, height: e.currentTarget.value })
                  }
                />
              </Group>
              <Text size="xs" c="dimmed">
                每边 320–3840 px，长边最多为短边的 2.3 倍。
                {custom.device.value !== "phoneScreenshots" &&
                  "平板也支持每边 1080–7680 px 的 16:9 横图或 9:16 竖图。"}
              </Text>
              <Button type="submit" disabled={!customValid}>
                应用分辨率
              </Button>
            </Stack>
          </form>
        )}
      </Modal>
      {historical.length > 0 && (
        <details>
          <summary>整理历史截图</summary>
          {historical.map((device) => (
            <div key={device.value}>
              <Text fw={600} mt="md">
                {device.label}
              </Text>
              <ScreenshotGroup
                {...props}
                group={device}
                groups={groups}
                historical
              />
            </div>
          ))}
        </details>
      )}
    </Paper>
  );
}
function ScreenshotGroup({
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
  function moveToGroup(src: string, target: string) {
    updateDraft((current) => {
      const existing = groupImages(current, target);
      const next = [...new Set([...existing, src])];
      if (next.length > (groups.find((g) => g.value === target)?.limit ?? 0)) {
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
  }
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  async function upload(files: File[]) {
    setBusy(true);
    const added: string[] = [];
    try {
      if (images.length + files.length > group.limit)
        throw new Error(`此设备组最多保存 ${group.limit} 张截图`);
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
              updateImages((current) => [...new Set([...current, url])])
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
                  <div className="screenshot-thumbnail">
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
          PNG / JPEG · 本地每张最多 20 MB
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
      <Modal
        opened={!!preview}
        onClose={() => setPreview(null)}
        title="截图预览"
        size="850px"
      >
        {preview && (
          <Stack>
            <ScreenshotViewer key={preview} src={preview} />
            <Text size="xs" c="dimmed">
              滚轮缩放，按住拖动平移。
            </Text>
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
                disabled={!enabled || !destination}
                onClick={() => destination && moveToGroup(preview, destination)}
              >
                移动截图
              </Button>
            </Group>
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
    </>
  );
}
