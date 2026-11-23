"use client";
import {
  Accordion,
  Badge,
  Group,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
} from "@mantine/core";
import type { Draft } from "../lib/model";
import {
  type StoreLocales,
  textDiff,
  type AppleSnapshot,
  type GoogleSnapshot,
} from "../lib/apple-sync-model";
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
export function StoreMetadata({
  entry,
  selectedLocale,
  local,
  apple,
  differences,
}: {
  entry: StoreLocales[string] | undefined;
  selectedLocale: string;
  local: Draft | undefined;
  apple: boolean;
  differences: ReturnType<typeof textDiff>;
}) {
  return (
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
                          <Badge size="xs" color="orange" variant="light">
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
                          <p className="diff-copy">{remote || "（空）"}</p>
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
  );
}
export function StoreAppDetails({
  snapshot,
}: {
  snapshot: AppleSnapshot | GoogleSnapshot;
}) {
  return (
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
                    snapshot.locales[snapshot.details.defaultLanguage ?? ""]
                      ?.draft.title,
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
                最早发布日期: snapshot.metadata?.earliestReleaseDate,
                主要分类: snapshot.metadata?.primaryCategoryId,
                次要分类: snapshot.metadata?.secondaryCategoryId,
                年龄分级: snapshot.metadata?.ageRating,
              },
        ).map(([label, value]) => (
          <Group key={label} justify="space-between" align="start">
            <Text size="sm" c="dimmed">
              {label}
            </Text>
            <Text size="sm" maw="65%" style={{ overflowWrap: "anywhere" }}>
              {value || "—"}
            </Text>
          </Group>
        ))}
      </Stack>
    </Tabs.Panel>
  );
}
