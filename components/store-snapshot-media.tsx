"use client";
import { Tabs, Stack, Group, Text, SimpleGrid } from "@mantine/core";
import { BatchDownload } from "./batch-download";
import type { AppleScreenshot, StoreLocales } from "../lib/apple-sync-model";
import { graphicTypes, graphicLabels, type Platform } from "../lib/model";
type MediaProps = {
  appId: string;
  platform: Platform;
  locale: string;
  onPreview: (image: AppleScreenshot, group: AppleScreenshot[]) => void;
};
export function StoreScreenshots({
  appId,
  platform,
  locale,
  onPreview,
  screenshots,
  groupLabel,
}: MediaProps & {
  screenshots: AppleScreenshot[];
  groupLabel: (device: string) => string;
}) {
  const groups = Object.groupBy(screenshots, (image) => image.deviceType);
  return (
    <Tabs.Panel value="screenshots" pt="lg">
      <Stack gap="lg">
        {!screenshots.length ? (
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
                      {shots.length} 张 · {shots[0]?.width} × {shots[0]?.height}
                    </Text>
                  </div>
                  <BatchDownload
                    appId={appId}
                    platform={platform}
                    locale={locale}
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
                          onClick={() => onPreview(image, shots)}
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
  );
}
export function StoreGraphics({
  appId,
  platform,
  locale,
  onPreview,
  graphics,
}: MediaProps & { graphics: StoreLocales[string]["graphics"] }) {
  return (
    <Tabs.Panel value="graphics" pt="lg">
      <Stack>
        <Group justify="flex-end">
          <BatchDownload
            appId={appId}
            platform={platform}
            locale={locale}
            group="商店图片资源"
            items={graphicTypes.flatMap((type) => {
              const url = graphics?.[type]?.url;
              return url ? [{ url, label: graphicLabels[type] }] : [];
            })}
          />
        </Group>
        {graphicTypes.map((type) => {
          const image = graphics?.[type];
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
                  onClick={() =>
                    onPreview(
                      image,
                      graphicTypes.flatMap((type) =>
                        graphics?.[type] ? [graphics[type]!] : [],
                      ),
                    )
                  }
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
                  {graphics
                    ? "此语言暂无该资源"
                    : "重新同步后可查看此语言的图片资源"}
                </Text>
              )}
            </Stack>
          );
        })}
      </Stack>
    </Tabs.Panel>
  );
}
