"use client";
import { fieldLabel } from "../lib/store-fields";
import {
  Paper,
  Group,
  Title,
  Text,
  Badge,
  Stack,
  SimpleGrid,
  TextInput,
  Textarea,
  Accordion,
} from "@mantine/core";
import type { Draft, Platform } from "../lib/model";
export function StoreCopyEditor({
  locale,
  draft,
  editable,
  platform,
  update,
  children,
}: {
  locale: string;
  draft: Draft;
  editable: boolean;
  platform: Platform;
  update: (patch: Partial<Draft>) => void;
  children: React.ReactNode;
}) {
  return (
    <Paper p={{ base: "md", sm: "xl" }}>
      <Group justify="space-between" mb="xl">
        <div>
          <Title order={3} size="h4">
            商店文案
          </Title>
          <Text size="xs" c="dimmed" mt={5}>
            让用户用自己的语言了解你的应用。
          </Text>
        </div>
        <Badge variant="light" color="gray">
          {locale}
        </Badge>
      </Group>
      <Stack gap="lg">
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput
            label={fieldLabel(platform, "title")}
            value={draft.title}
            disabled={!editable}
            onChange={(e) => update({ title: e.currentTarget.value })}
            placeholder="输入应用名称"
          />
          <TextInput
            label={fieldLabel(platform, "subtitle")}
            value={draft.subtitle}
            disabled={!editable}
            onChange={(e) => update({ subtitle: e.currentTarget.value })}
            placeholder="一句话描述应用的价值"
          />
        </SimpleGrid>
        <Textarea
          label={fieldLabel(platform, "description")}
          minRows={6}
          autosize
          maxRows={16}
          value={draft.description}
          disabled={!editable}
          onChange={(e) => update({ description: e.currentTarget.value })}
          placeholder="介绍应用的功能与特色…"
        />
        {platform === "google" && (
          <TextInput
            label={fieldLabel(platform, "video")}
            value={draft.video ?? ""}
            disabled={!editable}
            onChange={(e) => update({ video: e.currentTarget.value })}
          />
        )}
        <TextInput
          label={fieldLabel(platform, "keywords")}
          description={
            platform === "apple"
              ? "用英文逗号分隔关键词"
              : "仅供内部整理，不上传到 Google Play"
          }
          value={draft.keywords}
          disabled={!editable}
          onChange={(e) => update({ keywords: e.currentTarget.value })}
        />
      </Stack>
      {platform === "apple" && (
        <Accordion mt="lg" variant="default">
          <Accordion.Item value="more">
            <Accordion.Control>更多商店元数据</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="md">
                <Textarea
                  label={fieldLabel(platform, "promotionalText")}
                  value={draft.promotionalText ?? ""}
                  disabled={!editable}
                  onChange={(e) =>
                    update({
                      promotionalText: e.currentTarget.value,
                    })
                  }
                  minRows={2}
                />
                <Textarea
                  label={fieldLabel(platform, "whatsNew")}
                  value={draft.whatsNew ?? ""}
                  disabled={!editable}
                  onChange={(e) => update({ whatsNew: e.currentTarget.value })}
                  minRows={3}
                />
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  {(
                    [
                      "supportUrl",
                      "marketingUrl",
                      "privacyPolicyUrl",
                      "privacyChoicesUrl",
                    ] as const
                  ).map((field) => (
                    <TextInput
                      key={field}
                      label={fieldLabel(platform, field)}
                      value={draft[field] ?? ""}
                      disabled={!editable}
                      onChange={(e) =>
                        update({ [field]: e.currentTarget.value })
                      }
                    />
                  ))}
                </SimpleGrid>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
      {children}
    </Paper>
  );
}
