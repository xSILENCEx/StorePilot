"use client";
import { Fragment, useState } from "react";
import {
  Button,
  Group,
  Modal,
  TextInput,
  Menu,
  Anchor,
  Paper,
  Select,
  Stack,
  Text,
  Tabs,
} from "@mantine/core";
import {
  ChevronDown,
  Check,
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
import {
  deviceGroups,
  groupImages,
  screenDimensions,
  googleScreenshotDevices,
  validGoogleDimensions,
  ungrouped,
  type DeviceGroup,
} from "../lib/screenshot-groups";
import { ScreenshotGroup, type EditorProps } from "./screenshot-group";
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
    groups.find((g) => groupImages(draft, g.value).length) ??
    (platform === "apple"
      ? groups.find((g) => g.label === "iPhone · 灵动岛中屏")
      : undefined) ??
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
            return (
              <Tabs.Tab
                key={name}
                value={name}
                leftSection={<Icon size={24} strokeWidth={1.4} />}
              >
                {name}
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
